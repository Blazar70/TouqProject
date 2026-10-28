-- Two-step login (user 10-29): admins and managers must have signed in with a code (JWT aal = aal2) before any
-- clinic data or admin power opens. Everyone else may turn it on; their level is not checked.
-- The three helpers every policy goes through get the check, so a password alone reads nothing.
-- Own profile + own clinic name stay readable (direct auth.uid() policies), so the app can show the code screen.

create or replace function public.mfa_ok()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (select 1 from profiles where id = auth.uid() and (role = 'admin' or clinic_role = 'manager'));
$$;

create or replace function public.current_user_clinic_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select p.clinic_id
  from profiles p
  join clinics c on c.id = p.clinic_id
  where p.id = auth.uid() and p.role = 'vet' and not p.disabled and not c.disabled and public.mfa_ok();
$$;

create or replace function public.current_user_clinic_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select p.clinic_role
  from profiles p
  join clinics c on c.id = p.clinic_id
  where p.id = auth.uid() and p.role = 'vet' and not p.disabled and not c.disabled and public.mfa_ok();
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and not disabled
  ) and public.mfa_ok();
$$;
