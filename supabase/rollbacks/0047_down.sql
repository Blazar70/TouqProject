-- Undoes 0047_staff_accounts.sql, in one transaction:
-- psql "$DATABASE_URL" -1 -f <file>. Loses usernames and doctor assignments.
-- The caregivers table comes back EMPTY (its rows were dropped by 0047), and
-- managers keep no branch memberships (now meaning: whole clinic, as in 0045).

create or replace function public.current_user_branch_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select b.id
  from branches b
  where b.active
    and b.clinic_id = public.current_user_clinic_id()
    and (
      public.current_user_clinic_role() = 'manager'
      or exists (select 1 from staff_branches sb where sb.branch_id = b.id and sb.profile_id = auth.uid())
    );
$$;

-- back to the 0045 version
create or replace function public.enforce_profile_self_update_restrictions()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not (select current_user_is_admin()) then
    if new.role is distinct from old.role
      or new.clinic_id is distinct from old.clinic_id
      or new.disabled is distinct from old.disabled
      or new.clinic_role is distinct from old.clinic_role
      or new.takes_appointments is distinct from old.takes_appointments
      or new.title is distinct from old.title
      or new.calendar_order is distinct from old.calendar_order
    then
      raise exception 'only an admin may change role, clinic_id, disabled, clinic_role, takes_appointments, title, or calendar_order';
    end if;
  end if;
  return new;
end;
$$;

-- caregivers as left by 0001 + 0010 + 0032
create table caregivers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  name text not null,
  phone text,
  title text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table caregivers enable row level security;
create policy "caregivers_all_vet" on caregivers
  for all using (clinic_id = current_user_clinic_id());
create policy "caregivers_all_admin" on caregivers
  for all using (current_user_is_admin());
alter table appointments add column assigned_staff_id uuid references caregivers (id);

create or replace function public.admin_clinic_counts()
returns table (clinic_id uuid, pets bigint, appointments bigint, staff bigint)
language sql stable security invoker
set search_path = public
as $$
  select
    c.id,
    (select count(*) from pets p where p.clinic_id = c.id and p.deleted_at is null),
    (select count(*) from appointments a where a.clinic_id = c.id),
    (select count(*) from caregivers s where s.clinic_id = c.id and s.deleted_at is null)
  from clinics c;
$$;

select cron.schedule(
  'purge-trashed-pets-and-staff',
  '0 3 * * *',
  $$
  delete from pets where deleted_at is not null and deleted_at < now() - interval '7 days';
  update appointments set assigned_staff_id = null where assigned_staff_id in (
    select id from caregivers where deleted_at is not null and deleted_at < now() - interval '7 days'
  );
  delete from caregivers where deleted_at is not null and deleted_at < now() - interval '7 days';
  $$
);

alter table appointments drop constraint appointments_doctor_fkey;
alter table appointments drop column doctor_id;
alter table profiles drop constraint profiles_id_clinic_unique;
alter table profiles drop column username;
