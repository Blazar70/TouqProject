-- Checks for migration 0082 (inpatient reminders). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0082_inpatient_reminders_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 doctor, 2 nurse, 3 receptionist, 4 manager; all at the main branch.
insert into auth.users (id, email, aud, role) values
  ('f8200000-0000-0000-0000-000000000001', 'd82@check.local', 'authenticated', 'authenticated'),
  ('f8200000-0000-0000-0000-000000000002', 'n82@check.local', 'authenticated', 'authenticated'),
  ('f8200000-0000-0000-0000-000000000003', 'r82@check.local', 'authenticated', 'authenticated'),
  ('f8200000-0000-0000-0000-000000000004', 'm82@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f8200000-0000-0000-0000-00000000000a', '0082 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8200000-0000-0000-0000-000000000001', 'vet', 'f8200000-0000-0000-0000-00000000000a', 'D', 'doctor'),
  ('f8200000-0000-0000-0000-000000000002', 'vet', 'f8200000-0000-0000-0000-00000000000a', 'N', 'nurse'),
  ('f8200000-0000-0000-0000-000000000003', 'vet', 'f8200000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f8200000-0000-0000-0000-000000000004', 'vet', 'f8200000-0000-0000-0000-00000000000a', 'M', 'manager');
delete from staff_branches where profile_id::text like 'f8200000-%';
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f8200000-0000-0000-0000-000000000001', 'f8200000-0000-0000-0000-000000000002', 'f8200000-0000-0000-0000-000000000003']::uuid[]) p
  where b.clinic_id = 'f8200000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f8200000-0000-0000-0000-0000000000c1', 'f8200000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');
insert into inpatient_stays (id, clinic_id, pet_id, branch_id)
  select 'f8200000-0000-0000-0000-0000000000e1', 'f8200000-0000-0000-0000-00000000000a', 'f8200000-0000-0000-0000-0000000000c1', id
  from branches where clinic_id = 'f8200000-0000-0000-0000-00000000000a' and is_main;
-- Every 8 hours, started 20 hours ago: due -20h, -12h, -4h, then +4h, +12h ...
select set_config('check.start', (date_trunc('hour', now()) - interval '20 hours')::text, true);

set local role authenticated;

-- Nurse can't add a reminder; doctor can.
select set_config('request.jwt.claims', json_build_object('sub', 'f8200000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into inpatient_tasks (clinic_id, stay_id, label, every_hours, starts_at)
      values ('f8200000-0000-0000-0000-00000000000a', 'f8200000-0000-0000-0000-0000000000e1', 'x', 8, current_setting('check.start')::timestamptz);
    assert false, 'nurse must not add reminders';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'f8200000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into inpatient_tasks (id, clinic_id, stay_id, label, every_hours, starts_at)
  values ('f8200000-0000-0000-0000-0000000000a1', 'f8200000-0000-0000-0000-00000000000a', 'f8200000-0000-0000-0000-0000000000e1', 'Amoxicillin', 8, current_setting('check.start')::timestamptz);

-- Slots: the 3 past due times in the last day, the next one within 8 hours.
do $$
declare start timestamptz := current_setting('check.start')::timestamptz;
begin
  assert (select count(*) from inpatient_task_slots(now() - interval '1 day', now())) = 3, 'three due times so far';
  assert (select min(due_at) from inpatient_task_slots(now(), now() + interval '8 hours')) = start + interval '24 hours', 'next due time';
  assert (select count(*) from inpatient_task_slots(start + interval '1 minute', now())) = 2, 'window starts at the first due time after p_from';
  assert (select created_by from inpatient_tasks where id = 'f8200000-0000-0000-0000-0000000000a1') = 'f8200000-0000-0000-0000-000000000001', 'created_by set';
end $$;

-- Nurse marks the -4h dose done; a made-up time and a future dose are refused; reception can't tick.
select set_config('request.jwt.claims', json_build_object('sub', 'f8200000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
insert into inpatient_task_doses (clinic_id, task_id, due_at, done_by)
  values ('f8200000-0000-0000-0000-00000000000a', 'f8200000-0000-0000-0000-0000000000a1', current_setting('check.start')::timestamptz + interval '16 hours', 'f8200000-0000-0000-0000-000000000004');
do $$
declare start timestamptz := current_setting('check.start')::timestamptz;
begin
  assert (select done_by_name from inpatient_task_slots(now() - interval '1 day', now()) where due_at = start + interval '16 hours') = 'N', 'done by the nurse, not the client value';
  begin
    insert into inpatient_task_doses (clinic_id, task_id, due_at) values ('f8200000-0000-0000-0000-00000000000a', 'f8200000-0000-0000-0000-0000000000a1', start + interval '3 hours');
    assert false, 'a time that is not a due time must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into inpatient_task_doses (clinic_id, task_id, due_at) values ('f8200000-0000-0000-0000-00000000000a', 'f8200000-0000-0000-0000-0000000000a1', start + interval '32 hours');
    assert false, 'a dose hours away must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    insert into inpatient_task_doses (clinic_id, task_id, due_at) values ('f8200000-0000-0000-0000-00000000000a', 'f8200000-0000-0000-0000-0000000000a1', start + interval '16 hours');
    assert false, 'the same dose twice must be refused';
  exception when unique_violation then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'f8200000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from inpatient_task_slots(now() - interval '1 day', now())) = 3, 'reception sees the chart';
  begin
    insert into inpatient_task_doses (clinic_id, task_id, due_at) values ('f8200000-0000-0000-0000-00000000000a', 'f8200000-0000-0000-0000-0000000000a1', current_setting('check.start')::timestamptz + interval '8 hours');
    assert false, 'reception must not tick doses';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Doctor stops it: no due times after the stop; can't stop twice. Nurse can't stop.
select set_config('request.jwt.claims', json_build_object('sub', 'f8200000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
update inpatient_tasks set stopped_at = now() where id = 'f8200000-0000-0000-0000-0000000000a1';
do $$ begin assert (select stopped_at from inpatient_tasks where id = 'f8200000-0000-0000-0000-0000000000a1') is null, 'nurse must not stop'; end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'f8200000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
update inpatient_tasks set stopped_at = now() where id = 'f8200000-0000-0000-0000-0000000000a1';
do $$
begin
  assert (select count(*) from inpatient_task_slots(now(), now() + interval '2 days')) = 0, 'no due times after the stop';
  begin
    update inpatient_tasks set stopped_at = now() - interval '1 hour' where id = 'f8200000-0000-0000-0000-0000000000a1';
    assert false, 'second stop must be refused';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

reset role;
rollback;
select '0082 inpatient reminders: all checks passed' as result;
