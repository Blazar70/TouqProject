-- Touq / طوق — when a pet was checked in (nightly H12): "arrived 10:42" on the dashboard and the
-- appointment card, and "Next" picks the pet that has waited longest. Set by the database so every
-- path (buttons, Undo, reschedule) agrees; cleared when the check-in is undone.
alter table appointments add column arrived_at timestamptz;

create function public.set_appointment_arrived_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'arrived' and (tg_op = 'INSERT' or old.status is distinct from 'arrived') then
    new.arrived_at := now();
  elsif new.status in ('requested', 'confirmed') then
    new.arrived_at := null;
  end if;
  return new;
end;
$$;

-- "zz" so it runs after the other BEFORE triggers (they run in name order) and sees the final status.
create trigger appointments_zz_arrived_at
  before insert or update of status on appointments
  for each row execute function public.set_appointment_arrived_at();
