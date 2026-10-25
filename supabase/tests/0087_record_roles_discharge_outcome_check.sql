-- Checks for migration 0087 (record roles, discharge outcome, skip, inpatient media delete). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0087_record_roles_discharge_outcome_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;
-- Lets this test delete storage rows to exercise the delete policy; transaction-local, rolled back below.
select set_config('storage.allow_delete_query', 'true', true);

-- 1 receptionist, 2 doctor, 3 manager, 4 nurse.
insert into auth.users (id, email, aud, role) values
  ('f8700000-0000-0000-0000-000000000001', 'r87@check.local', 'authenticated', 'authenticated'),
  ('f8700000-0000-0000-0000-000000000002', 'd87@check.local', 'authenticated', 'authenticated'),
  ('f8700000-0000-0000-0000-000000000003', 'm87@check.local', 'authenticated', 'authenticated'),
  ('f8700000-0000-0000-0000-000000000004', 'n87@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f8700000-0000-0000-0000-00000000000a', '0087 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8700000-0000-0000-0000-000000000001', 'vet', 'f8700000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f8700000-0000-0000-0000-000000000002', 'vet', 'f8700000-0000-0000-0000-00000000000a', 'D', 'doctor'),
  ('f8700000-0000-0000-0000-000000000003', 'vet', 'f8700000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f8700000-0000-0000-0000-000000000004', 'vet', 'f8700000-0000-0000-0000-00000000000a', 'N', 'nurse');
delete from staff_branches where profile_id::text like 'f8700000-%';
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f8700000-0000-0000-0000-000000000001', 'f8700000-0000-0000-0000-000000000002', 'f8700000-0000-0000-0000-000000000004']::uuid[]) p
  where b.clinic_id = 'f8700000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f8700000-0000-0000-0000-0000000000c1', 'f8700000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');
select set_config('check.branch', (select id::text from branches where clinic_id = 'f8700000-0000-0000-0000-00000000000a' and is_main), true);
insert into storage.objects (bucket_id, name, owner_id) values
  ('inpatient-media', 'f8700000-0000-0000-0000-00000000000a/f8700000-0000-0000-0000-0000000000c1/s/doctor.jpg', 'f8700000-0000-0000-0000-000000000002'),
  ('inpatient-media', 'f8700000-0000-0000-0000-00000000000a/f8700000-0000-0000-0000-0000000000c1/s/other.jpg', 'f8700000-0000-0000-0000-000000000002');

set local role authenticated;

-- Doctor writes a record; receptionist can't add, edit or delete one.
select set_config('request.jwt.claims', json_build_object('sub', 'f8700000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
insert into medical_records (id, pet_id, clinic_id, branch_id, visit_date, diagnosis)
  values ('f8700000-0000-0000-0000-0000000000e1', 'f8700000-0000-0000-0000-0000000000c1', 'f8700000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid, current_date, 'Otitis');

select set_config('request.jwt.claims', json_build_object('sub', 'f8700000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into medical_records (pet_id, clinic_id, branch_id, visit_date) values ('f8700000-0000-0000-0000-0000000000c1', 'f8700000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid, current_date);
    assert false, 'receptionist must not add records';
  exception when raise_exception then null;
  end;
  begin
    update medical_records set diagnosis = 'changed' where id = 'f8700000-0000-0000-0000-0000000000e1';
    assert false, 'receptionist must not edit records';
  exception when raise_exception then null;
  end;
  begin
    delete from medical_records where id = 'f8700000-0000-0000-0000-0000000000e1';
    assert false, 'receptionist must not delete records';
  exception when raise_exception then null;
  end;
  assert (select count(*) from medical_records where id = 'f8700000-0000-0000-0000-0000000000e1') = 1, 'receptionist still reads records';
  -- Receptionist can't delete a doctor's inpatient photo.
  delete from storage.objects where name like 'f8700000-%doctor.jpg';
end $$;

-- Manager edits; the doctor's photo is still there.
select set_config('request.jwt.claims', json_build_object('sub', 'f8700000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
update medical_records set treatment = 'Drops' where id = 'f8700000-0000-0000-0000-0000000000e1';
do $$
begin
  assert (select count(*) from storage.objects where name like 'f8700000-%doctor.jpg') = 1, 'receptionist must not have deleted the photo';
  assert (select treatment = 'Drops' from medical_records where id = 'f8700000-0000-0000-0000-0000000000e1'), 'manager can edit records';
end $$;

-- Uploader (doctor) deletes own file.
select set_config('request.jwt.claims', json_build_object('sub', 'f8700000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
delete from storage.objects where name like 'f8700000-%doctor.jpg';
do $$
begin
  assert (select count(*) from storage.objects where name like 'f8700000-%doctor.jpg') = 0, 'uploader must be able to delete own file';
end $$;

-- Discharge outcome: only on a discharged stay, only the four values.
reset role;
insert into inpatient_stays (id, clinic_id, pet_id, branch_id)
  values ('f8700000-0000-0000-0000-0000000000f1', 'f8700000-0000-0000-0000-00000000000a', 'f8700000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid);
do $$
begin
  begin
    update inpatient_stays set discharge_outcome = 'home' where id = 'f8700000-0000-0000-0000-0000000000f1';
    assert false, 'outcome needs a discharge';
  exception when check_violation then null;
  end;
  begin
    update inpatient_stays set discharged_at = now(), discharge_outcome = 'lost' where id = 'f8700000-0000-0000-0000-0000000000f1';
    assert false, 'unknown outcome must be refused';
  exception when check_violation then null;
  end;
  update inpatient_stays set discharged_at = now(), discharge_outcome = 'died' where id = 'f8700000-0000-0000-0000-0000000000f1';
end $$;

-- Skip mark defaults to false.
do $$
begin
  assert (select column_default = 'false' from information_schema.columns where table_name = 'owner_reminders_sent' and column_name = 'skipped'), 'skipped defaults to false';
end $$;

rollback;
