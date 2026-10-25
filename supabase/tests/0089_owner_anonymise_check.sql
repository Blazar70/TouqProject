-- Checks for migration 0089 (owner anonymise). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0089_owner_anonymise_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 receptionist, 2 manager.
insert into auth.users (id, email, aud, role) values
  ('f8900000-0000-0000-0000-000000000001', 'r89@check.local', 'authenticated', 'authenticated'),
  ('f8900000-0000-0000-0000-000000000002', 'm89@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f8900000-0000-0000-0000-00000000000a', '0089 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8900000-0000-0000-0000-000000000001', 'vet', 'f8900000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f8900000-0000-0000-0000-000000000002', 'vet', 'f8900000-0000-0000-0000-00000000000a', 'M', 'manager');
insert into owner_files (id, clinic_id, name, phone, email, notes) values
  ('f8900000-0000-0000-0000-0000000000f1', 'f8900000-0000-0000-0000-00000000000a', 'Real Name', '+966501110001', 'real@example.com', 'likes calls');
insert into pets (id, clinic_id, name, species, owner_name, owner_phone, owner_file_id) values
  ('f8900000-0000-0000-0000-0000000000c1', 'f8900000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'Real Name', '+966501110001', 'f8900000-0000-0000-0000-0000000000f1');
insert into pet_trusted_contacts (pet_id, name, phone) values ('f8900000-0000-0000-0000-0000000000c1', 'Cousin', '+966501110002');

set local role authenticated;

-- Receptionist can't.
select set_config('request.jwt.claims', json_build_object('sub', 'f8900000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.anonymise_owner_file('f8900000-0000-0000-0000-0000000000f1');
    assert false, 'receptionist must not anonymise';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Manager anonymises: owner and pet copies cleared, trusted contacts gone, pet kept, log has no real name.
select set_config('request.jwt.claims', json_build_object('sub', 'f8900000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  perform public.anonymise_owner_file('f8900000-0000-0000-0000-0000000000f1');
  assert (select name like 'Deleted owner #%' and phone is null and email is null and notes is null and anonymised_at is not null
          from owner_files where id = 'f8900000-0000-0000-0000-0000000000f1'), 'owner must be anonymised';
  assert (select owner_name like 'Deleted owner #%' and owner_phone is null and owner_email is null
          from pets where id = 'f8900000-0000-0000-0000-0000000000c1'), 'pet copies must be cleared';
  assert (select count(*) from pet_trusted_contacts where pet_id = 'f8900000-0000-0000-0000-0000000000c1') = 0, 'trusted contacts must be deleted';
  assert (select name = 'Rex' from pets where id = 'f8900000-0000-0000-0000-0000000000c1'), 'the pet stays';
  assert not exists (select 1 from admin_audit_log where clinic_id = 'f8900000-0000-0000-0000-00000000000a' and target_label like '%Real Name%'), 'log must not keep the real name';
  begin
    perform public.anonymise_owner_file('f8900000-0000-0000-0000-0000000000f1');
    assert false, 'twice must be refused';
  exception when raise_exception then null;
  end;
end $$;

rollback;
