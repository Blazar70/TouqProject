-- Checks for migration 0097 (admin import of owners and pets). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0097_admin_import_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f9700000-0000-0000-0000-000000000001', 'a97@check.local', 'authenticated', 'authenticated'),
  ('f9700000-0000-0000-0000-000000000002', 'm97@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f9700000-0000-0000-0000-00000000000a', '0097 check');
insert into profiles (id, role, full_name) values ('f9700000-0000-0000-0000-000000000001', 'admin', 'A');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f9700000-0000-0000-0000-000000000002', 'vet', 'f9700000-0000-0000-0000-00000000000a', 'M', 'manager');
insert into owner_files (id, clinic_id, name, phone) values
  ('f9700000-0000-0000-0000-0000000000f1', 'f9700000-0000-0000-0000-00000000000a', 'Already here', '+966501111111');

set local role authenticated;

-- Manager (even with a code) can't import.
select set_config('request.jwt.claims', json_build_object('sub', 'f9700000-0000-0000-0000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$
begin
  perform public.admin_import_owners_pets('f9700000-0000-0000-0000-00000000000a', '[{"owner_name": "X", "pet_name": "Y", "species": "Dog"}]');
  assert false, 'a manager must not import';
exception when raise_exception then null;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'f9700000-0000-0000-0000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$
declare
  v jsonb;
begin
  v := public.admin_import_owners_pets('f9700000-0000-0000-0000-00000000000a', '[
    {"owner_name": "Sara", "owner_phone": "+966502222222", "pet_name": "Milo", "species": "Cat", "date_of_birth": "2022-03-01"},
    {"owner_name": "Sara", "owner_phone": "+966502222222", "pet_name": "Luna", "species": "Cat"},
    {"owner_name": "Old owner", "owner_phone": "+966501111111", "pet_name": "Rex", "species": "Dog"},
    {"owner_name": "No phone", "pet_name": "Kiwi", "species": "Bird"}
  ]');
  assert v = '{"pets": 4, "new_owners": 2, "matched_owners": 1}'::jsonb, 'counts: ' || v::text;
  assert (select count(*) from pets where owner_file_id = 'f9700000-0000-0000-0000-0000000000f1') = 1, 'Rex joins the existing owner';
  assert (select owner_name from pets where name = 'Rex' and clinic_id = 'f9700000-0000-0000-0000-00000000000a') = 'Already here', 'pet takes the owner file name';
  assert (select count(distinct owner_file_id) from pets where name in ('Milo', 'Luna') and clinic_id = 'f9700000-0000-0000-0000-00000000000a') = 1, 'one owner for both cats';
  assert exists (select 1 from admin_audit_log where action = 'owners_pets_imported' and clinic_id = 'f9700000-0000-0000-0000-00000000000a'), 'import is logged';

  begin
    perform public.admin_import_owners_pets('f9700000-0000-0000-0000-00000000000a', '[
      {"owner_name": "Good", "pet_name": "One", "species": "Dog"},
      {"owner_name": "Bad", "owner_phone": "12345", "pet_name": "Two", "species": "Dog"}
    ]');
    assert false, 'a bad phone must stop the import';
  exception when raise_exception then null;
  end;
  assert not exists (select 1 from pets where name = 'One' and clinic_id = 'f9700000-0000-0000-0000-00000000000a'), 'nothing saved from a failed import';
end $$;

rollback;
