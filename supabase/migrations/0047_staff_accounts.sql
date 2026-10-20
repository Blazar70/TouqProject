-- Touq / طوق — staff are logins (phase 2 of
-- docs/design/staff-branches-calendar.md, §1.2 and §3). Every staff member
-- signs in with a username; the old `caregivers` records (names without a
-- login) are retired and appointments point at a doctor's profile instead.
-- Decided 2026-10-20: retire caregivers now rather than in a later
-- migration; existing assignments are dropped (all test data resets at v2).

-- Usernames are unique across Touq, so login needs nothing but username +
-- password. The auth email is derived from it (<username>@staff.touq.invalid,
-- see supabase/functions/_shared/staff.ts); .invalid can never deliver mail.
alter table profiles
  add column username text unique
    check (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');

-- appointments.doctor_id must name a profile of the same clinic, like the
-- branch columns in 0046. Only doctor_id is cleared if that profile goes.
alter table profiles add constraint profiles_id_clinic_unique unique (id, clinic_id);
alter table appointments add column doctor_id uuid;
alter table appointments add constraint appointments_doctor_fkey
  foreign key (doctor_id, clinic_id) references profiles (id, clinic_id)
  on delete set null (doctor_id);

alter table appointments drop column assigned_staff_id;
drop table caregivers;

-- Same nightly job without the caregivers lines (0035 version otherwise).
select cron.schedule(
  'purge-trashed-pets-and-staff',
  '0 3 * * *',
  $$ delete from pets where deleted_at is not null and deleted_at < now() - interval '7 days'; $$
);

-- Staff = enabled clinic accounts.
create or replace function public.admin_clinic_counts()
returns table (clinic_id uuid, pets bigint, appointments bigint, staff bigint)
language sql stable security invoker
set search_path = public
as $$
  select
    c.id,
    (select count(*) from pets p where p.clinic_id = c.id and p.deleted_at is null),
    (select count(*) from appointments a where a.clinic_id = c.id),
    (select count(*) from profiles s where s.clinic_id = c.id and s.role = 'vet' and not s.disabled)
  from clinics c;
$$;

-- The staff edge functions write with the service role, where auth.uid() is
-- null and current_user_is_admin() is false; let them through. username
-- joins the guarded columns.
create or replace function public.enforce_profile_self_update_restrictions()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if not (select current_user_is_admin()) then
    if new.role is distinct from old.role
      or new.clinic_id is distinct from old.clinic_id
      or new.disabled is distinct from old.disabled
      or new.clinic_role is distinct from old.clinic_role
      or new.takes_appointments is distinct from old.takes_appointments
      or new.title is distinct from old.title
      or new.calendar_order is distinct from old.calendar_order
      or new.username is distinct from old.username
    then
      raise exception 'only an admin may change role, clinic_id, disabled, clinic_role, takes_appointments, title, calendar_order, or username';
    end if;
  end if;
  return new;
end;
$$;

-- Per-branch managers: a manager with staff_branches rows manages only those
-- branches; one without rows manages the whole clinic (as in 0045). 0044 gave
-- every account a Main membership, which would now shrink existing managers
-- to Main only, so clear theirs.
delete from staff_branches sb using profiles p where p.id = sb.profile_id and p.clinic_role = 'manager';

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
      exists (select 1 from staff_branches sb where sb.branch_id = b.id and sb.profile_id = auth.uid())
      or (
        public.current_user_clinic_role() = 'manager'
        and not exists (select 1 from staff_branches sb where sb.profile_id = auth.uid())
      )
    );
$$;
