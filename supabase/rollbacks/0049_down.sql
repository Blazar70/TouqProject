-- Undoes 0049_profile_login_email.sql: psql "$DATABASE_URL" -1 -f <file>.
-- The emails stay in auth.users; only the copy on profiles goes.

-- back to the 0047 version
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

alter table profiles drop column email;
