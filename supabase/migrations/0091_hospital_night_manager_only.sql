-- Touq / طوق — nightly 10-27 S15. All staff may edit the price list (0074), but which service is the
-- hospital night (0086) prices every "Bill this stay", so only a manager (or the platform admin) may
-- set, move or delete it. The Settings page already limits the picker to managers; this is the server side.

create function public.services_hospital_night_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.hospital_night)
     or (tg_op = 'UPDATE' and new.hospital_night is distinct from old.hospital_night)
     or (tg_op = 'DELETE' and old.hospital_night) then
    -- auth.uid() is null for jobs and SQL run by the owner of the database.
    if auth.uid() is not null and not public.current_user_has_role(array['manager']) and not public.current_user_is_admin() then
      raise exception 'Only a manager can choose the hospital night service' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger services_hospital_night_guard
before insert or update or delete on services
for each row execute function public.services_hospital_night_guard();
