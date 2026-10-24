-- Checks for migration 0083 (storage and name locks). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0083_storage_and_name_locks_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 doctor, 2 manager of clinic a; 3 manager of clinic b.
insert into auth.users (id, email, aud, role) values
  ('f8300000-0000-0000-0000-000000000001', 'd83@check.local', 'authenticated', 'authenticated'),
  ('f8300000-0000-0000-0000-000000000002', 'm83@check.local', 'authenticated', 'authenticated'),
  ('f8300000-0000-0000-0000-000000000003', 'o83@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f8300000-0000-0000-0000-00000000000a', '0083 check a'),
  ('f8300000-0000-0000-0000-00000000000b', '0083 check b');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8300000-0000-0000-0000-000000000001', 'vet', 'f8300000-0000-0000-0000-00000000000a', 'D', 'doctor'),
  ('f8300000-0000-0000-0000-000000000002', 'vet', 'f8300000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f8300000-0000-0000-0000-000000000003', 'vet', 'f8300000-0000-0000-0000-00000000000b', 'O', 'manager');
insert into storage.objects (bucket_id, name) values
  ('clinic-logos', 'f8300000-0000-0000-0000-00000000000a/logo'),
  ('clinic-logos', 'f8300000-0000-0000-0000-00000000000b/logo');

do $$
begin
  assert (select allowed_mime_types = array['application/pdf'] and file_size_limit = 10485760
          from storage.buckets where id = 'payment-documents'), 'payment-documents must be PDF only, 10 MB';
end $$;

-- Anonymous visitors can no longer list logos.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'clinic-logos' and name like 'f8300000-%') = 0,
    'anon must not list clinic-logos';
end $$;

-- Manager of clinic a sees only their own logo.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f8300000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'clinic-logos' and name like 'f8300000-%') = 1,
    'manager must see only their own clinic logo';
end $$;

-- Doctor can't rename themselves but can still change their phone.
select set_config('request.jwt.claims', json_build_object('sub', 'f8300000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'clinic-logos' and name like 'f8300000-%') = 0,
    'doctor must not list logos';
  update profiles set phone = '+966500000000' where id = 'f8300000-0000-0000-0000-000000000001';
  begin
    update profiles set full_name = 'Someone else' where id = 'f8300000-0000-0000-0000-000000000001';
    assert false, 'staff must not rename themselves';
  exception when raise_exception then null;
  end;
end $$;

rollback;
