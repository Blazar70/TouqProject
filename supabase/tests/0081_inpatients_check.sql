-- Checks for migration 0081 (inpatients). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0081_inpatients_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 doctor (Main), 2 nurse (North), 3 receptionist (Main + North), 4 whole-clinic manager, 5 nurse (Main).
insert into auth.users (id, email, aud, role) values
  ('f8100000-0000-0000-0000-000000000001', 'd81@check.local', 'authenticated', 'authenticated'),
  ('f8100000-0000-0000-0000-000000000002', 'n81@check.local', 'authenticated', 'authenticated'),
  ('f8100000-0000-0000-0000-000000000003', 'r81@check.local', 'authenticated', 'authenticated'),
  ('f8100000-0000-0000-0000-000000000004', 'm81@check.local', 'authenticated', 'authenticated'),
  ('f8100000-0000-0000-0000-000000000005', 'n281@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f8100000-0000-0000-0000-00000000000a', '0081 check');
insert into branches (id, clinic_id, name) values ('f8100000-0000-0000-0000-0000000000b2', 'f8100000-0000-0000-0000-00000000000a', 'North');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8100000-0000-0000-0000-000000000001', 'vet', 'f8100000-0000-0000-0000-00000000000a', 'D', 'doctor'),
  ('f8100000-0000-0000-0000-000000000002', 'vet', 'f8100000-0000-0000-0000-00000000000a', 'N', 'nurse'),
  ('f8100000-0000-0000-0000-000000000003', 'vet', 'f8100000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f8100000-0000-0000-0000-000000000004', 'vet', 'f8100000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f8100000-0000-0000-0000-000000000005', 'vet', 'f8100000-0000-0000-0000-00000000000a', 'N2', 'nurse');
select set_config('check.main', (select id::text from branches where clinic_id = 'f8100000-0000-0000-0000-00000000000a' and is_main), true);
select set_config('check.north', 'f8100000-0000-0000-0000-0000000000b2', true);
delete from staff_branches where profile_id::text like 'f8100000-%';
insert into staff_branches (profile_id, branch_id) values
  ('f8100000-0000-0000-0000-000000000001', current_setting('check.main')::uuid),
  ('f8100000-0000-0000-0000-000000000002', current_setting('check.north')::uuid),
  ('f8100000-0000-0000-0000-000000000003', current_setting('check.main')::uuid),
  ('f8100000-0000-0000-0000-000000000003', current_setting('check.north')::uuid),
  ('f8100000-0000-0000-0000-000000000005', current_setting('check.main')::uuid);
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f8100000-0000-0000-0000-0000000000c1', 'f8100000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');

set local role authenticated;

-- Nurse can't admit; doctor admits at Main; a second open stay is refused.
select set_config('request.jwt.claims', json_build_object('sub', 'f8100000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into inpatient_stays (clinic_id, pet_id, branch_id) values ('f8100000-0000-0000-0000-00000000000a', 'f8100000-0000-0000-0000-0000000000c1', current_setting('check.north')::uuid);
    assert false, 'nurse admit must be refused';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'f8100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into inpatient_stays (id, clinic_id, pet_id, branch_id, reason, admitted_by)
  values ('f8100000-0000-0000-0000-0000000000e1', 'f8100000-0000-0000-0000-00000000000a', 'f8100000-0000-0000-0000-0000000000c1', current_setting('check.main')::uuid, 'Fluids', 'f8100000-0000-0000-0000-000000000004');
do $$
begin
  assert (select admitted_by from inpatient_stays where id = 'f8100000-0000-0000-0000-0000000000e1') = 'f8100000-0000-0000-0000-000000000001', 'admitted_by is the caller, not the client value';
  begin
    insert into inpatient_stays (clinic_id, pet_id, branch_id) values ('f8100000-0000-0000-0000-00000000000a', 'f8100000-0000-0000-0000-0000000000c1', current_setting('check.main')::uuid);
    assert false, 'second open stay must be refused';
  exception when unique_violation then null;
  end;
  begin
    insert into inpatient_stays (clinic_id, pet_id, branch_id) values ('f8100000-0000-0000-0000-00000000000a', 'f8100000-0000-0000-0000-0000000000c1', current_setting('check.north')::uuid);
    assert false, 'doctor must not admit at a branch they do not work at';
  exception when sqlstate 'P0001' then null; when unique_violation then null;
  end;
  begin
    update inpatient_stays set branch_id = current_setting('check.north')::uuid where id = 'f8100000-0000-0000-0000-0000000000e1';
    assert false, 'clients must not move a stay directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Nurse at North writes an update: the pet moves to North. Receptionist can't write updates.
select set_config('request.jwt.claims', json_build_object('sub', 'f8100000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
insert into inpatient_updates (id, clinic_id, stay_id, branch_id, author_id, note, temperature_c)
  values ('f8100000-0000-0000-0000-0000000000f1', 'f8100000-0000-0000-0000-00000000000a', 'f8100000-0000-0000-0000-0000000000e1', current_setting('check.north')::uuid, 'f8100000-0000-0000-0000-000000000002', 'Ate a little', 38.6);
do $$
begin
  assert (select branch_id from inpatient_stays where id = 'f8100000-0000-0000-0000-0000000000e1') = current_setting('check.north')::uuid, 'latest update moves the pet';
  begin
    insert into inpatient_updates (clinic_id, stay_id, branch_id, author_id, note) values ('f8100000-0000-0000-0000-00000000000a', 'f8100000-0000-0000-0000-0000000000e1', current_setting('check.main')::uuid, 'f8100000-0000-0000-0000-000000000002', 'x');
    assert false, 'nurse must not write at a branch she does not work at';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into inpatient_updates (clinic_id, stay_id, branch_id, author_id) values ('f8100000-0000-0000-0000-00000000000a', 'f8100000-0000-0000-0000-0000000000e1', current_setting('check.north')::uuid, 'f8100000-0000-0000-0000-000000000002');
    assert false, 'an empty update must be refused';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'f8100000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from inpatient_updates where stay_id = 'f8100000-0000-0000-0000-0000000000e1') = 1, 'reception reads updates';
  begin
    insert into inpatient_updates (clinic_id, stay_id, branch_id, author_id, note) values ('f8100000-0000-0000-0000-00000000000a', 'f8100000-0000-0000-0000-0000000000e1', current_setting('check.main')::uuid, 'f8100000-0000-0000-0000-000000000003', 'x');
    assert false, 'receptionist update must be refused';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Another nurse can't delete it; the author can't edit it; the manager can delete it.
select set_config('request.jwt.claims', json_build_object('sub', 'f8100000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
delete from inpatient_updates where id = 'f8100000-0000-0000-0000-0000000000f1';
select set_config('request.jwt.claims', json_build_object('sub', 'f8100000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  assert exists (select 1 from inpatient_updates where id = 'f8100000-0000-0000-0000-0000000000f1'), 'another nurse must not delete it';
  begin
    update inpatient_updates set note = 'changed' where id = 'f8100000-0000-0000-0000-0000000000f1';
    assert false, 'updates are never edited';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'f8100000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
delete from inpatient_updates where id = 'f8100000-0000-0000-0000-0000000000f1';
do $$ begin assert not exists (select 1 from inpatient_updates where id = 'f8100000-0000-0000-0000-0000000000f1'), 'manager deletes an update'; end $$;

-- Doctor discharges; no second discharge; no updates after discharge.
select set_config('request.jwt.claims', json_build_object('sub', 'f8100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
update inpatient_stays set discharged_at = now(), discharge_note = 'Home' where id = 'f8100000-0000-0000-0000-0000000000e1';
do $$
begin
  assert (select discharged_by from inpatient_stays where id = 'f8100000-0000-0000-0000-0000000000e1') = 'f8100000-0000-0000-0000-000000000001', 'discharged_by set';
  begin
    update inpatient_stays set discharged_at = now() - interval '1 day' where id = 'f8100000-0000-0000-0000-0000000000e1';
    assert false, 'second discharge must be refused';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'f8100000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into inpatient_updates (clinic_id, stay_id, branch_id, author_id, note) values ('f8100000-0000-0000-0000-00000000000a', 'f8100000-0000-0000-0000-0000000000e1', current_setting('check.north')::uuid, 'f8100000-0000-0000-0000-000000000002', 'x');
    assert false, 'no updates after discharge';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
select '0081 inpatients: all checks passed' as result;
