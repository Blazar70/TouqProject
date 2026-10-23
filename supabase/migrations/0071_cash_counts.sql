-- 0071: counted cash on the daily cash-up (P2, nightly H7).
-- One count per branch and clinic day: the cash actually in the drawer, compared with
-- what the cash-up report expects. Receptionists and managers enter it; reception only
-- for today (correctable the same day), managers may correct an earlier day.
-- Who counted and when are set by the database; the latest count is kept.

create table cash_counts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  branch_id uuid not null,
  day date not null,
  counted numeric(10, 2) not null check (counted >= 0),
  counted_by uuid references profiles (id) on delete set null,
  counted_at timestamptz not null default now(),
  unique (branch_id, day),
  foreign key (branch_id, clinic_id) references branches (id, clinic_id) on delete cascade
);

create function public.cash_counts_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_today date := (select (now() at time zone timezone)::date from clinics where id = new.clinic_id);
begin
  if not public.current_user_has_role(array['receptionist', 'manager']) then
    raise exception 'Only receptionists and managers can count cash' using errcode = 'P0001';
  end if;
  if new.day > v_today then
    raise exception 'A cash count can''t be for a future day' using errcode = 'P0001';
  end if;
  if new.day < v_today and not public.current_user_has_role(array['manager']) then
    raise exception 'Only a manager can correct an earlier day''s cash count' using errcode = 'P0001';
  end if;
  new.counted_by := auth.uid();
  new.counted_at := now();
  return new;
end;
$$;

create trigger cash_counts_guard
  before insert or update on cash_counts
  for each row execute function public.cash_counts_guard();

alter table cash_counts enable row level security;
create policy "cash_counts_all_staff" on cash_counts
  for all using (clinic_id = (select current_user_clinic_id()))
  with check (clinic_id = (select current_user_clinic_id()));
create policy "cash_counts_all_admin" on cash_counts
  for all using (current_user_is_admin());
revoke delete on cash_counts from anon, authenticated;

notify pgrst, 'reload schema';
