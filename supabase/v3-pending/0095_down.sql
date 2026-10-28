-- Undo 0095: helpers back to their 0028 / 0031 / 0045 bodies, mfa_ok dropped.
create or replace function public.current_user_clinic_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select p.clinic_id
  from profiles p
  join clinics c on c.id = p.clinic_id
  where p.id = auth.uid() and p.role = 'vet' and not p.disabled and not c.disabled;
$$;

create or replace function public.current_user_clinic_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select p.clinic_role
  from profiles p
  join clinics c on c.id = p.clinic_id
  where p.id = auth.uid() and p.role = 'vet' and not p.disabled and not c.disabled;
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and not disabled
  );
$$;

drop function public.mfa_ok();
