-- Touq / طوق — show real-email logins (decided 2026-10-20). Staff log in with
-- a username (profiles.username, 0047) or, when added from the admin desk, a
-- real email. That email only lived in auth.users, so the app couldn't show it.
-- Synthetic <username>@staff.touq.invalid addresses are never stored here.

alter table profiles add column email text unique check (email = lower(email));

update profiles p
set email = lower(u.email)
from auth.users u
where u.id = p.id and u.email is not null and u.email not like '%@staff.touq.invalid';

-- email joins the guarded columns: only an admin or the staff edge functions
-- (service role) may change a login.
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
      or new.email is distinct from old.email
    then
      raise exception 'only an admin may change role, clinic_id, disabled, clinic_role, takes_appointments, title, calendar_order, username, or email';
    end if;
  end if;
  return new;
end;
$$;
