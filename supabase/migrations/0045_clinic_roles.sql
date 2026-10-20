-- Touq / طوق — roles inside a clinic (phase 1 of
-- docs/design/staff-branches-calendar.md, §1.1 and §2.2). `profiles.role`
-- stays as is (`vet` = any clinic account), so every existing policy keeps
-- working; `clinic_role` says what that account may do inside its clinic.
-- Additive: no policy uses the new helpers yet (the role policies are a
-- later phase).

alter table profiles
  add column clinic_role text check (clinic_role in ('manager', 'doctor', 'nurse', 'receptionist')),
  add column takes_appointments boolean not null default false,
  add column title text,
  add column calendar_order integer,
  -- pre-fills the branch picker only; never used for access.
  add column last_branch_id uuid references branches (id) on delete set null;

-- CONFIRM WITH THE CLINIC: the earliest-created account per clinic is taken
-- to be its manager (the account admin-manage-clinic created with the
-- clinic). Fix by hand if the clinic names someone else.
update profiles p
set clinic_role = case when p.id = first.id then 'manager' else 'doctor' end,
    takes_appointments = p.id <> first.id
from (
  select distinct on (clinic_id) id, clinic_id
  from profiles
  where role = 'vet'
  order by clinic_id, created_at, id
) first
where p.role = 'vet' and p.clinic_id = first.clinic_id;

alter table profiles add constraint profiles_vet_has_clinic_role
  check (role <> 'vet' or clinic_role is not null);

-- admin-manage-clinic (create, add_staff) inserts profiles without a
-- clinic_role until phase 2; apply the same rule as the backfill above.
create function public.fill_default_clinic_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.role = 'vet' and new.clinic_role is null then
    if exists (select 1 from profiles where clinic_id = new.clinic_id and role = 'vet') then
      new.clinic_role := 'doctor';
      new.takes_appointments := true;
    else
      new.clinic_role := 'manager';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_fill_default_clinic_role
  before insert on profiles
  for each row execute function public.fill_default_clinic_role();

-- profiles_update_own (0001) lets a user update their own row, so without
-- this a doctor could make themselves manager. last_branch_id stays
-- self-editable on purpose. Replaced after the backfill above, which runs
-- with no auth.uid() and would otherwise be blocked.
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

-- Same disabled gates as current_user_clinic_id() (0031), so a disabled user
-- or clinic has no role and no branches.
create function public.current_user_clinic_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select p.clinic_role
  from profiles p
  join clinics c on c.id = p.clinic_id
  where p.id = auth.uid() and p.role = 'vet' and not p.disabled and not c.disabled;
$$;

create function public.current_user_has_role(roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_user_clinic_role() = any (roles), false);
$$;

-- Inactive branches are excluded for everyone: a closed branch is not a
-- place anyone can work from.
create function public.current_user_branch_ids()
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
