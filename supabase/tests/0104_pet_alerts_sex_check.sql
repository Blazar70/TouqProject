-- Checks for migration 0104 (pet alerts, sex, neutered). RUN ON STAGING ONLY; one transaction, rolled back at the end.
begin;

insert into auth.users (id, email, aud, role) values
  ('f1040000-0000-0000-0000-000000000001', 'm104@check.local', 'authenticated', 'authenticated'),
  ('f1040000-0000-0000-0000-000000000002', 'r104@check.local', 'authenticated', 'authenticated'),
  ('f1040000-0000-0000-0000-000000000003', 'n104@check.local', 'authenticated', 'authenticated'),
  ('f1040000-0000-0000-0000-000000000004', 'd104@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f1040000-0000-0000-0000-00000000000a', '0104 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f1040000-0000-0000-0000-000000000001', 'vet', 'f1040000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f1040000-0000-0000-0000-000000000002', 'vet', 'f1040000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f1040000-0000-0000-0000-000000000003', 'vet', 'f1040000-0000-0000-0000-00000000000a', 'N', 'nurse'),
  ('f1040000-0000-0000-0000-000000000004', 'vet', 'f1040000-0000-0000-0000-00000000000a', 'D', 'doctor');
insert into pets (id, clinic_id, name, species, owner_name, owner_phone) values
  ('f1040000-0000-0000-0000-0000000000c1', 'f1040000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner', '+966501040001');
select set_config('check.branch', (select id::text from branches where clinic_id = 'f1040000-0000-0000-0000-00000000000a' limit 1), true);
insert into staff_branches (profile_id, branch_id)
  select p, current_setting('check.branch')::uuid
  from unnest(array['f1040000-0000-0000-0000-000000000002', 'f1040000-0000-0000-0000-000000000003', 'f1040000-0000-0000-0000-000000000004']::uuid[]) p;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1040000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);

-- A receptionist may edit the alert and the new fields.
update pets set alerts = 'Allergic to penicillin', sex = 'female', neutered = true where id = 'f1040000-0000-0000-0000-0000000000c1';
do $$ begin
  assert (select alerts from pets where id = 'f1040000-0000-0000-0000-0000000000c1') = 'Allergic to penicillin', 'receptionist could not set the alert';
  begin
    update pets set sex = 'x' where id = 'f1040000-0000-0000-0000-0000000000c1';
    assert false, 'a bad sex value was accepted';
  exception when check_violation then null;
  end;
  begin
    update pets set alerts = '   ' where id = 'f1040000-0000-0000-0000-0000000000c1';
    assert false, 'a blank alert was accepted';
  exception when check_violation then null;
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1040000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
update pets set alerts = 'Bites' where id = 'f1040000-0000-0000-0000-0000000000c1';
do $$ begin
  assert (select alerts from pets where id = 'f1040000-0000-0000-0000-0000000000c1') = 'Bites', 'nurse could not set the alert';
end $$;
rollback;
