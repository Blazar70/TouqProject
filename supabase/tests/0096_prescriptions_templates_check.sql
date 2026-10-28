-- Checks for migration 0096 (prescriptions and visit templates). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0096_prescriptions_templates_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 receptionist, 2 doctor, 3 nurse.
insert into auth.users (id, email, aud, role) values
  ('f9600000-0000-0000-0000-000000000001', 'r96@check.local', 'authenticated', 'authenticated'),
  ('f9600000-0000-0000-0000-000000000002', 'd96@check.local', 'authenticated', 'authenticated'),
  ('f9600000-0000-0000-0000-000000000003', 'n96@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f9600000-0000-0000-0000-00000000000a', '0096 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f9600000-0000-0000-0000-000000000001', 'vet', 'f9600000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f9600000-0000-0000-0000-000000000002', 'vet', 'f9600000-0000-0000-0000-00000000000a', 'D', 'doctor'),
  ('f9600000-0000-0000-0000-000000000003', 'vet', 'f9600000-0000-0000-0000-00000000000a', 'N', 'nurse');
delete from staff_branches where profile_id::text like 'f9600000-%';
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f9600000-0000-0000-0000-000000000002', 'f9600000-0000-0000-0000-000000000003']::uuid[]) p
  where b.clinic_id = 'f9600000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f9600000-0000-0000-0000-0000000000c1', 'f9600000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');
select set_config('check.branch', (select id::text from branches where clinic_id = 'f9600000-0000-0000-0000-00000000000a' and is_main), true);

set local role authenticated;

-- Doctor: writes a prescription and a template.
select set_config('request.jwt.claims', json_build_object('sub', 'f9600000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  insert into medical_records (id, pet_id, clinic_id, branch_id, diagnosis, prescription)
    values ('f9600000-0000-0000-0000-0000000000e1', 'f9600000-0000-0000-0000-0000000000c1', 'f9600000-0000-0000-0000-00000000000a',
      current_setting('check.branch')::uuid, 'Otitis', '[{"medicine": "Ear drops", "dose": "3 drops", "frequency": "twice a day", "duration": "7 days", "note": ""}]');
  insert into visit_templates (clinic_id, name, fields, prescription)
    values ('f9600000-0000-0000-0000-00000000000a', 'Ear check', '{"diagnosis": "Otitis"}', '[]');
  begin
    insert into visit_templates (clinic_id, name, prescription) values ('f9600000-0000-0000-0000-00000000000a', 'Bad', '{"a": 1}');
    assert false, 'a template prescription must be a list';
  exception when check_violation then null;
  end;
end $$;

-- Nurse: reads templates, can't write them or a prescription.
select set_config('request.jwt.claims', json_build_object('sub', 'f9600000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from visit_templates where clinic_id = 'f9600000-0000-0000-0000-00000000000a') = 1, 'nurse reads templates';
  begin
    insert into visit_templates (clinic_id, name) values ('f9600000-0000-0000-0000-00000000000a', 'Nurse one');
    assert false, 'nurse must not write templates';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into medical_records (pet_id, clinic_id, branch_id, prescription)
      values ('f9600000-0000-0000-0000-0000000000c1', 'f9600000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid,
        '[{"medicine": "Ear drops"}]');
    assert false, 'nurse must not write a prescription';
  exception when raise_exception then null;
  end;
  insert into medical_records (pet_id, clinic_id, branch_id, presenting_complaint)
    values ('f9600000-0000-0000-0000-0000000000c1', 'f9600000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid, 'Scratching');
end $$;

-- Receptionist: sees no templates.
select set_config('request.jwt.claims', json_build_object('sub', 'f9600000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from visit_templates where clinic_id = 'f9600000-0000-0000-0000-00000000000a') = 0, 'receptionist must not read templates';
end $$;

rollback;
