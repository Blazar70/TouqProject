-- Checks for migration 0076 (branch writes, clinic info, owner merge/move, staff branches). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0076_branch_and_clinic_roles_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 doctor (Main), 2 receptionist (Main), 3 branch manager (North), 4 whole-clinic manager, 5 doctor (Main + North).
insert into auth.users (id, email, aud, role) values
  ('f7600000-0000-0000-0000-000000000001', 'd76@check.local', 'authenticated', 'authenticated'),
  ('f7600000-0000-0000-0000-000000000002', 'r76@check.local', 'authenticated', 'authenticated'),
  ('f7600000-0000-0000-0000-000000000003', 'bm76@check.local', 'authenticated', 'authenticated'),
  ('f7600000-0000-0000-0000-000000000004', 'm76@check.local', 'authenticated', 'authenticated'),
  ('f7600000-0000-0000-0000-000000000005', 'd276@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f7600000-0000-0000-0000-00000000000a', '0076 check');
insert into branches (id, clinic_id, name) values ('f7600000-0000-0000-0000-0000000000b2', 'f7600000-0000-0000-0000-00000000000a', 'North');
insert into profiles (id, role, clinic_id, full_name, clinic_role, takes_appointments) values
  ('f7600000-0000-0000-0000-000000000001', 'vet', 'f7600000-0000-0000-0000-00000000000a', 'D', 'doctor', true),
  ('f7600000-0000-0000-0000-000000000002', 'vet', 'f7600000-0000-0000-0000-00000000000a', 'R', 'receptionist', false),
  ('f7600000-0000-0000-0000-000000000003', 'vet', 'f7600000-0000-0000-0000-00000000000a', 'BM', 'manager', false),
  ('f7600000-0000-0000-0000-000000000004', 'vet', 'f7600000-0000-0000-0000-00000000000a', 'M', 'manager', false),
  ('f7600000-0000-0000-0000-000000000005', 'vet', 'f7600000-0000-0000-0000-00000000000a', 'D2', 'doctor', true);
select set_config('check.main', (select id::text from branches where clinic_id = 'f7600000-0000-0000-0000-00000000000a' and is_main), true);
select set_config('check.north', 'f7600000-0000-0000-0000-0000000000b2', true);
delete from staff_branches where profile_id::text like 'f7600000-%';
insert into staff_branches (profile_id, branch_id) values
  ('f7600000-0000-0000-0000-000000000001', current_setting('check.main')::uuid),
  ('f7600000-0000-0000-0000-000000000002', current_setting('check.main')::uuid),
  ('f7600000-0000-0000-0000-000000000003', current_setting('check.north')::uuid),
  ('f7600000-0000-0000-0000-000000000005', current_setting('check.main')::uuid),
  ('f7600000-0000-0000-0000-000000000005', current_setting('check.north')::uuid);
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', 'Pet one', 'dog', 'Owner one'),
  ('f7600000-0000-0000-0000-0000000000c2', 'f7600000-0000-0000-0000-00000000000a', 'Pet two', 'cat', 'Owner two'),
  ('f7600000-0000-0000-0000-0000000000c3', 'f7600000-0000-0000-0000-00000000000a', 'Pet three', 'cat', 'Owner three');
insert into appointments (id, pet_id, clinic_id, created_by, doctor_id, scheduled_at, status, branch_id) values
  ('f7600000-0000-0000-0000-0000000000a1', 'f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', 'f7600000-0000-0000-0000-000000000004', 'f7600000-0000-0000-0000-000000000005', now() + interval '1 day', 'confirmed', current_setting('check.north')::uuid),
  ('f7600000-0000-0000-0000-0000000000a2', 'f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', 'f7600000-0000-0000-0000-000000000004', 'f7600000-0000-0000-0000-000000000005', now() + interval '1 day 1 hour', 'confirmed', current_setting('check.main')::uuid),
  ('f7600000-0000-0000-0000-0000000000a3', 'f7600000-0000-0000-0000-0000000000c3', 'f7600000-0000-0000-0000-00000000000a', 'f7600000-0000-0000-0000-000000000004', null, now() + interval '2 days', 'confirmed', current_setting('check.north')::uuid);
insert into medical_records (id, pet_id, clinic_id, vet_id, branch_id) values
  ('f7600000-0000-0000-0000-0000000000e1', 'f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', 'f7600000-0000-0000-0000-000000000005', current_setting('check.north')::uuid);

set local role authenticated;

-- Doctor at Main: reads North, writes only Main.
select set_config('request.jwt.claims', json_build_object('sub', 'f7600000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from appointments where id = 'f7600000-0000-0000-0000-0000000000a1') = 1, 'doctor must read a North appointment';
  assert (select count(*) from medical_records where id = 'f7600000-0000-0000-0000-0000000000e1') = 1, 'doctor must read a North record';
  insert into appointments (pet_id, clinic_id, created_by, scheduled_at, status, branch_id) values
    ('f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', 'f7600000-0000-0000-0000-000000000001', now() + interval '3 days', 'requested', current_setting('check.main')::uuid);
  insert into appointments (pet_id, clinic_id, created_by, scheduled_at, status) values
    ('f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', 'f7600000-0000-0000-0000-000000000001', now() + interval '3 days 1 hour', 'requested');
  begin
    insert into appointments (pet_id, clinic_id, created_by, scheduled_at, status, branch_id) values
      ('f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', 'f7600000-0000-0000-0000-000000000001', now() + interval '3 days', 'requested', current_setting('check.north')::uuid);
    assert false, 'booking at North must be refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'You can only make changes at a branch you work at', sqlerrm;
  end;
  begin
    update appointments set status = 'requested' where id = 'f7600000-0000-0000-0000-0000000000a1';
    assert false, 'editing a North appointment must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update appointments set branch_id = current_setting('check.north')::uuid where id = 'f7600000-0000-0000-0000-0000000000a2';
    assert false, 'moving an appointment to North must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update medical_records set notes = 'x' where id = 'f7600000-0000-0000-0000-0000000000e1';
    assert false, 'editing a North record must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into medical_records (pet_id, clinic_id, branch_id) values
      ('f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', current_setting('check.north')::uuid);
    assert false, 'a record at North must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  insert into medical_records (pet_id, clinic_id, branch_id) values
    ('f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', current_setting('check.main')::uuid);
  -- Owner moves and merges: not for clinicians. Details stay open.
  update owner_files set notes = 'doctor note' where id = (select owner_file_id from pets where id = 'f7600000-0000-0000-0000-0000000000c1');
  begin
    update pets set owner_file_id = (select owner_file_id from pets where id = 'f7600000-0000-0000-0000-0000000000c2') where id = 'f7600000-0000-0000-0000-0000000000c1';
    assert false, 'doctor pet move must be refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'Only receptionists and managers can merge owners or move pets', sqlerrm;
  end;
  begin
    perform merge_owner_files((select owner_file_id from pets where id = 'f7600000-0000-0000-0000-0000000000c1'), (select owner_file_id from pets where id = 'f7600000-0000-0000-0000-0000000000c2'));
    assert false, 'doctor merge must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  -- Clinic info: managers only.
  begin
    update clinics set name = 'Renamed' where id = 'f7600000-0000-0000-0000-00000000000a';
    assert false, 'doctor rename must be refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'Only managers can change the clinic info', sqlerrm;
  end;
  assert not has_function_privilege('replace_staff_branches(uuid, uuid[])', 'execute'), 'staff must not swap branches directly';
  -- Deleting a pet takes its North history with it (cascade, not a branch write).
  delete from pets where id = 'f7600000-0000-0000-0000-0000000000c3';
  assert (select count(*) from appointments where id = 'f7600000-0000-0000-0000-0000000000a3') = 0, 'pet delete must cascade';
end $$;

-- Receptionist at Main: money only at Main; merges and moves.
select set_config('request.jwt.claims', json_build_object('sub', 'f7600000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_owner uuid := (select owner_file_id from pets where id = 'f7600000-0000-0000-0000-0000000000c1');
  v_inv uuid;
begin
  begin
    perform create_invoice('f7600000-0000-0000-0000-0000000000c1', current_setting('check.north')::uuid, null, null,
      '[{"description": "Exam", "unit_price": 115, "quantity": 1}]', null, '[]');
    assert false, 'invoice at North must be refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'You can only make changes at a branch you work at', sqlerrm;
  end;
  v_inv := create_invoice('f7600000-0000-0000-0000-0000000000c1', current_setting('check.main')::uuid, null, null,
    '[{"description": "Exam", "unit_price": 115, "quantity": 1}]', null, '[]');
  begin
    perform add_invoice_payment(v_inv, 'cash', 10, current_setting('check.north')::uuid);
    assert false, 'payment at North must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  perform add_invoice_payment(v_inv, 'cash', 10, current_setting('check.main')::uuid);
  begin
    perform add_owner_balance(v_owner, 20, 'cash', null, current_setting('check.north')::uuid);
    assert false, 'deposit at North must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  perform add_owner_balance(v_owner, 20, 'cash', null, current_setting('check.main')::uuid);
  perform add_invoice_payment(v_inv, 'balance', 5, current_setting('check.main')::uuid);
  begin
    insert into cash_counts (clinic_id, branch_id, day, counted) values ('f7600000-0000-0000-0000-00000000000a', current_setting('check.north')::uuid, (now() at time zone 'Asia/Riyadh')::date, 1);
    assert false, 'cash count at North must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  insert into cash_counts (clinic_id, branch_id, day, counted) values ('f7600000-0000-0000-0000-00000000000a', current_setting('check.main')::uuid, (now() at time zone 'Asia/Riyadh')::date, 1);
  update pets set owner_file_id = (select owner_file_id from pets where id = 'f7600000-0000-0000-0000-0000000000c2') where id = 'f7600000-0000-0000-0000-0000000000c1';
  perform merge_owner_files(v_owner, (select owner_file_id from pets where id = 'f7600000-0000-0000-0000-0000000000c2'));
  assert (select count(*) from pets where owner_file_id = v_owner and clinic_id = 'f7600000-0000-0000-0000-00000000000a') = 2, 'merge must move both pets';
end $$;

-- Branch manager (North): phone yes, VAT/cap no; time off still unassigns a Main appointment.
select set_config('request.jwt.claims', json_build_object('sub', 'f7600000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  update clinics set phone = '0110000000' where id = 'f7600000-0000-0000-0000-00000000000a';
  assert (select phone from clinics where id = 'f7600000-0000-0000-0000-00000000000a') = '0110000000', 'branch manager must change the phone';
  begin
    update clinics set max_staff_discount_percent = 50 where id = 'f7600000-0000-0000-0000-00000000000a';
    assert false, 'branch manager cap change must be refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'Only a whole-clinic manager can change the VAT number or discount limit', sqlerrm;
  end;
  begin
    update appointments set status = 'requested' where id = 'f7600000-0000-0000-0000-0000000000a2';
    assert false, 'North manager editing a Main appointment must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  assert save_doctor_time_off(null, 'f7600000-0000-0000-0000-000000000005', now(), now() + interval '2 days', 'Leave') = 2,
    'time off must unassign the North and the Main appointment';
  assert current_setting('touq.branch_write_free', true) = 'off', 'time off must close the bypass';
end $$;

-- Whole-clinic manager: writes everywhere, sets VAT/cap.
select set_config('request.jwt.claims', json_build_object('sub', 'f7600000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
do $$
begin
  update clinics set vat_number = '300000000000003', max_staff_discount_percent = 20 where id = 'f7600000-0000-0000-0000-00000000000a';
  update appointments set status = 'requested' where id = 'f7600000-0000-0000-0000-0000000000a1';
  insert into appointments (pet_id, clinic_id, created_by, scheduled_at, status, branch_id) values
    ('f7600000-0000-0000-0000-0000000000c1', 'f7600000-0000-0000-0000-00000000000a', 'f7600000-0000-0000-0000-000000000004', now() + interval '4 days', 'requested', current_setting('check.north')::uuid);
end $$;

-- Server side swaps branches in one go.
reset role;
select set_config('request.jwt.claims', '', true);
select replace_staff_branches('f7600000-0000-0000-0000-000000000005', array[current_setting('check.north')::uuid]);
do $$
begin
  assert (select array_agg(branch_id) from staff_branches where profile_id = 'f7600000-0000-0000-0000-000000000005') = array[current_setting('check.north')::uuid],
    'replace_staff_branches must leave exactly the new rows';
end $$;

rollback;
