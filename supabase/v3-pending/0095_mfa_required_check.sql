-- Checks for migration 0095 (two-step login for admins and managers). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0095_mfa_required_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f9500000-0000-0000-0000-000000000001', 'm95@check.local', 'authenticated', 'authenticated'),
  ('f9500000-0000-0000-0000-000000000002', 'r95@check.local', 'authenticated', 'authenticated'),
  ('f9500000-0000-0000-0000-000000000003', 'a95@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f9500000-0000-0000-0000-00000000000a', '0095 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f9500000-0000-0000-0000-000000000001', 'vet', 'f9500000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f9500000-0000-0000-0000-000000000002', 'vet', 'f9500000-0000-0000-0000-00000000000a', 'R', 'receptionist');
insert into profiles (id, role, full_name) values ('f9500000-0000-0000-0000-000000000003', 'admin', 'A');

create function pg_temp.as_user(uid text, aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
$$;

set local role authenticated;

do $$
begin
  perform pg_temp.as_user('f9500000-0000-0000-0000-000000000001', 'aal1');
  assert public.current_user_clinic_id() is null, 'manager with password only gets no clinic';
  assert public.current_user_clinic_role() is null, 'manager with password only gets no role';
  assert exists (select 1 from profiles where id = auth.uid()), 'manager can still read own profile to see the code screen';
  perform pg_temp.as_user('f9500000-0000-0000-0000-000000000001', 'aal2');
  assert public.current_user_clinic_id() = 'f9500000-0000-0000-0000-00000000000a', 'manager with code gets the clinic';

  perform pg_temp.as_user('f9500000-0000-0000-0000-000000000002', 'aal1');
  assert public.current_user_clinic_role() = 'receptionist', 'receptionist is not forced';

  perform pg_temp.as_user('f9500000-0000-0000-0000-000000000003', 'aal1');
  assert not public.current_user_is_admin(), 'admin with password only is not admin';
  perform pg_temp.as_user('f9500000-0000-0000-0000-000000000003', 'aal2');
  assert public.current_user_is_admin(), 'admin with code is admin';
end $$;

rollback;
