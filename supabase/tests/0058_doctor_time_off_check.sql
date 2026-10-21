-- Checks for migration 0058 (doctor time off). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0058_doctor_time_off_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f5800000-0000-0000-0000-000000000001', 'm@check.local', 'authenticated', 'authenticated'),
  ('f5800000-0000-0000-0000-000000000002', 'bm@check.local', 'authenticated', 'authenticated'),
  ('f5800000-0000-0000-0000-000000000003', 'dn@check.local', 'authenticated', 'authenticated'),
  ('f5800000-0000-0000-0000-000000000004', 'de@check.local', 'authenticated', 'authenticated'),
  ('f5800000-0000-0000-0000-000000000005', 'r@check.local', 'authenticated', 'authenticated');

insert into clinics (id, name) values ('f5800000-0000-0000-0000-00000000000a', 'Time off check');
insert into branches (id, clinic_id, name) values
  ('f5800000-0000-0000-0000-0000000000b1', 'f5800000-0000-0000-0000-00000000000a', 'North'),
  ('f5800000-0000-0000-0000-0000000000b2', 'f5800000-0000-0000-0000-00000000000a', 'East');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f5800000-0000-0000-0000-000000000001', 'vet', 'f5800000-0000-0000-0000-00000000000a', 'Whole manager', 'manager'),
  ('f5800000-0000-0000-0000-000000000002', 'vet', 'f5800000-0000-0000-0000-00000000000a', 'East manager', 'manager'),
  ('f5800000-0000-0000-0000-000000000003', 'vet', 'f5800000-0000-0000-0000-00000000000a', 'North doctor', 'doctor'),
  ('f5800000-0000-0000-0000-000000000004', 'vet', 'f5800000-0000-0000-0000-00000000000a', 'East doctor', 'doctor'),
  ('f5800000-0000-0000-0000-000000000005', 'vet', 'f5800000-0000-0000-0000-00000000000a', 'Receptionist', 'receptionist');
delete from staff_branches where profile_id::text like 'f5800000-%';
insert into staff_branches (profile_id, branch_id) values
  ('f5800000-0000-0000-0000-000000000002', 'f5800000-0000-0000-0000-0000000000b2'),
  ('f5800000-0000-0000-0000-000000000003', 'f5800000-0000-0000-0000-0000000000b1'),
  ('f5800000-0000-0000-0000-000000000004', 'f5800000-0000-0000-0000-0000000000b2'),
  ('f5800000-0000-0000-0000-000000000005', 'f5800000-0000-0000-0000-0000000000b1');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f5800000-0000-0000-0000-0000000000c1', 'f5800000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');

-- North doctor's day: the period will be 2030-01-10 00:00 to 23:59 Riyadh.
insert into appointments (id, pet_id, clinic_id, branch_id, created_by, doctor_id, scheduled_at, status) values
  ('f5800000-0000-0000-0000-0000000000a1', 'f5800000-0000-0000-0000-0000000000c1', 'f5800000-0000-0000-0000-00000000000a', 'f5800000-0000-0000-0000-0000000000b1', 'f5800000-0000-0000-0000-000000000001', 'f5800000-0000-0000-0000-000000000003', '2030-01-10 09:00+03', 'requested'),
  ('f5800000-0000-0000-0000-0000000000a2', 'f5800000-0000-0000-0000-0000000000c1', 'f5800000-0000-0000-0000-00000000000a', 'f5800000-0000-0000-0000-0000000000b1', 'f5800000-0000-0000-0000-000000000001', 'f5800000-0000-0000-0000-000000000003', '2030-01-10 10:00+03', 'confirmed'),
  ('f5800000-0000-0000-0000-0000000000a3', 'f5800000-0000-0000-0000-0000000000c1', 'f5800000-0000-0000-0000-00000000000a', 'f5800000-0000-0000-0000-0000000000b1', 'f5800000-0000-0000-0000-000000000001', 'f5800000-0000-0000-0000-000000000003', '2030-01-10 11:00+03', 'in_session'),
  ('f5800000-0000-0000-0000-0000000000a4', 'f5800000-0000-0000-0000-0000000000c1', 'f5800000-0000-0000-0000-00000000000a', 'f5800000-0000-0000-0000-0000000000b1', 'f5800000-0000-0000-0000-000000000001', 'f5800000-0000-0000-0000-000000000003', '2030-01-10 12:00+03', 'completed'),
  ('f5800000-0000-0000-0000-0000000000a5', 'f5800000-0000-0000-0000-0000000000c1', 'f5800000-0000-0000-0000-00000000000a', 'f5800000-0000-0000-0000-0000000000b1', 'f5800000-0000-0000-0000-000000000001', 'f5800000-0000-0000-0000-000000000003', '2030-01-10 13:00+03', 'cancelled'),
  ('f5800000-0000-0000-0000-0000000000a6', 'f5800000-0000-0000-0000-0000000000c1', 'f5800000-0000-0000-0000-00000000000a', 'f5800000-0000-0000-0000-0000000000b1', 'f5800000-0000-0000-0000-000000000001', 'f5800000-0000-0000-0000-000000000003', '2030-01-11 09:00+03', 'requested');

set local role authenticated;

-- A doctor and a receptionist can't add time off.
select set_config('request.jwt.claims', json_build_object('sub', 'f5800000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform save_doctor_time_off(null, 'f5800000-0000-0000-0000-000000000003', '2030-01-10 00:00+03', '2030-01-10 23:59+03', 'x');
    assert false, 'doctor added time off';
  exception when raise_exception then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'f5800000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform save_doctor_time_off(null, 'f5800000-0000-0000-0000-000000000003', '2030-01-10 00:00+03', '2030-01-10 23:59+03', 'x');
    assert false, 'receptionist added time off';
  exception when raise_exception then null;
  end;
  insert into doctor_time_off (clinic_id, doctor_id, starts_at, ends_at, reason)
  values ('f5800000-0000-0000-0000-00000000000a', 'f5800000-0000-0000-0000-000000000003', '2030-01-10', '2030-01-11', 'x');
  assert false, 'receptionist inserted directly';
exception when insufficient_privilege then null;
end $$;

-- East branch manager: East doctor yes, North doctor no.
select set_config('request.jwt.claims', json_build_object('sub', 'f5800000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$ begin
  assert save_doctor_time_off(null, 'f5800000-0000-0000-0000-000000000004', '2030-02-01 00:00+03', '2030-02-01 23:59+03', 'Conference') = 0,
    'east manager could not add time off for the East doctor';
  begin
    perform save_doctor_time_off(null, 'f5800000-0000-0000-0000-000000000003', '2030-01-10 00:00+03', '2030-01-10 23:59+03', 'x');
    assert false, 'east manager added time off for a North doctor';
  exception when raise_exception then null;
  end;
end $$;

-- Whole-clinic manager: North doctor's day off unassigns requested + confirmed inside it, nothing else.
select set_config('request.jwt.claims', json_build_object('sub', 'f5800000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_moved integer;
begin
  v_moved := save_doctor_time_off(null, 'f5800000-0000-0000-0000-000000000003', '2030-01-10 00:00+03', '2030-01-10 23:59+03', 'Sick leave');
  assert v_moved = 2, 'expected 2 unassigned, got ' || v_moved;
  assert (select count(*) from appointments where doctor_id is null and id::text like 'f5800000-%') = 2, 'wrong rows unassigned';
  assert (select doctor_id from appointments where id = 'f5800000-0000-0000-0000-0000000000a3') is not null, 'in_session touched';
  assert (select doctor_id from appointments where id = 'f5800000-0000-0000-0000-0000000000a4') is not null, 'completed touched';
  assert (select doctor_id from appointments where id = 'f5800000-0000-0000-0000-0000000000a5') is not null, 'cancelled touched';
  assert (select doctor_id from appointments where id = 'f5800000-0000-0000-0000-0000000000a6') is not null, 'next day touched';
  assert (select reason from doctor_time_off where doctor_id = 'f5800000-0000-0000-0000-000000000003') = 'Sick leave',
    'manager cannot read the reason';
end $$;

-- Receptionist sees the period but not the row with the reason.
select set_config('request.jwt.claims', json_build_object('sub', 'f5800000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
do $$ begin
  assert not exists (select 1 from doctor_time_off), 'receptionist can read time-off rows (reason)';
  assert (select count(*) from doctor_time_off_periods('2030-01-01', '2030-03-01')) = 2, 'receptionist cannot see away periods';
  delete from doctor_time_off;
  assert not found, 'receptionist deleted time off';
end $$;
-- The doctor themself doesn't see the reason either.
select set_config('request.jwt.claims', json_build_object('sub', 'f5800000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$ begin
  assert not exists (select 1 from doctor_time_off), 'doctor can read time-off reason';
end $$;

-- Booking or moving onto the away doctor is refused; outside the period is fine.
do $$ begin
  begin
    insert into appointments (pet_id, clinic_id, branch_id, created_by, doctor_id, scheduled_at)
    values ('f5800000-0000-0000-0000-0000000000c1', 'f5800000-0000-0000-0000-00000000000a', 'f5800000-0000-0000-0000-0000000000b1',
            'f5800000-0000-0000-0000-000000000003', 'f5800000-0000-0000-0000-000000000003', '2030-01-10 15:00+03');
    assert false, 'booked an away doctor';
  exception when raise_exception then null;
  end;
  begin
    update appointments set scheduled_at = '2030-01-10 16:00+03' where id = 'f5800000-0000-0000-0000-0000000000a6';
    assert false, 'rescheduled onto an away doctor';
  exception when raise_exception then null;
  end;
  begin
    update appointments set doctor_id = 'f5800000-0000-0000-0000-000000000003' where id = 'f5800000-0000-0000-0000-0000000000a1';
    assert false, 'assigned an away doctor';
  exception when raise_exception then null;
  end;
  update appointments set scheduled_at = '2030-01-11 10:00+03' where id = 'f5800000-0000-0000-0000-0000000000a6';
  assert found, 'reschedule outside the period refused';
  -- Status changes on an appointment already inside the period still work.
  update appointments set status = 'completed' where id = 'f5800000-0000-0000-0000-0000000000a3';
  assert found, 'status change inside the period refused';
end $$;

-- Manager shortens, then deletes: nothing is reassigned.
select set_config('request.jwt.claims', json_build_object('sub', 'f5800000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_id uuid;
begin
  select id into v_id from doctor_time_off where doctor_id = 'f5800000-0000-0000-0000-000000000003';
  perform save_doctor_time_off(v_id, null, '2030-01-10 12:00+03', '2030-01-10 23:59+03', 'Half day');
  delete from doctor_time_off where id = v_id;
  assert found, 'manager could not delete';
  assert (select count(*) from appointments where doctor_id is null and id::text like 'f5800000-%') = 2, 'appointments were reassigned';
end $$;

reset role;
do $$
declare
  v_actions text[];
begin
  select array_agg(action order by action) into v_actions
  from admin_audit_log where clinic_id = 'f5800000-0000-0000-0000-00000000000a';
  assert v_actions = array['time_off_added', 'time_off_added', 'time_off_deleted', 'time_off_updated'],
    'unexpected log: ' || coalesce(v_actions::text, 'none');
  assert exists (select 1 from admin_audit_log where clinic_id = 'f5800000-0000-0000-0000-00000000000a'
                 and actor_name = 'East manager' and target_label = 'East doctor · 2030-02-01 00:00 – 2030-02-01 23:59'),
    'log label wrong';
  assert not exists (select 1 from admin_audit_log where clinic_id = 'f5800000-0000-0000-0000-00000000000a' and target_label like '%Sick%'),
    'reason leaked into the log';
end $$;

select 'all 0058 checks passed' as result;
rollback;
