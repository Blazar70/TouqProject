-- Touq / طوق — clinic/vet onboarding moves from public self-signup to an
-- admin-only flow (Edge Function using the service role, which bypasses RLS
-- entirely). Two things fall out of that:
--
-- 1. `profiles_insert_own` / `clinics_insert_authenticated` (added in
--    0003_signup_policies.sql for the self-signup form) have no remaining
--    legitimate caller now that the form is gone — and they were broader
--    than intended: `profiles_insert_own` only checked `id = auth.uid()`,
--    never restricting the `role` column, so any authenticated user could
--    have inserted a profile row with role='admin' for themselves via a
--    direct API call, bypassing the signup form's UI-only role dropdown.
--    Dropping both closes that hole.
-- 2. `profiles_update_own` (0001_init.sql) has the same gap on UPDATE: it
--    only checks `id = auth.uid()`, so any logged-in user could currently
--    grant themselves admin, move themselves to another clinic, or
--    re-enable their own disabled account by updating their own row
--    directly. A trigger enforcing that non-admins can't touch
--    role/clinic_id/disabled on their own profile closes this without
--    having to rewrite the policy itself (mirrors the existing
--    enforce_pet_owner_field_restrictions column-level guard on pets).

drop policy if exists "profiles_insert_own" on profiles;
drop policy if exists "clinics_insert_authenticated" on clinics;

create function public.enforce_profile_self_update_restrictions()
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

create trigger profiles_self_update_restrictions
  before update on profiles
  for each row execute function public.enforce_profile_self_update_restrictions();
