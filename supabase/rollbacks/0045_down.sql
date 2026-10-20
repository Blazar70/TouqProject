-- Undoes 0045_clinic_roles.sql. Run after 0046_down.sql, in one transaction:
-- psql "$DATABASE_URL" -1 -f <file>. Loses every clinic_role assignment.

drop function public.current_user_branch_ids();
drop function public.current_user_has_role(text[]);
drop function public.current_user_clinic_role();

drop trigger profiles_fill_default_clinic_role on profiles;
drop function public.fill_default_clinic_role();

-- back to the 0029 version
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
    then
      raise exception 'only an admin may change role, clinic_id, or disabled';
    end if;
  end if;
  return new;
end;
$$;

alter table profiles drop constraint profiles_vet_has_clinic_role;
alter table profiles
  drop column clinic_role,
  drop column takes_appointments,
  drop column title,
  drop column calendar_order,
  drop column last_branch_id;
