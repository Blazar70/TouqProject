-- Checks for migration 0088 (phase-4 shortcuts). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0088_phase4_shortcuts_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 receptionist, 2 doctor, 3 nurse, 4 manager.
insert into auth.users (id, email, aud, role) values
  ('f8800000-0000-0000-0000-000000000001', 'r88@check.local', 'authenticated', 'authenticated'),
  ('f8800000-0000-0000-0000-000000000002', 'd88@check.local', 'authenticated', 'authenticated'),
  ('f8800000-0000-0000-0000-000000000003', 'n88@check.local', 'authenticated', 'authenticated'),
  ('f8800000-0000-0000-0000-000000000004', 'm88@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f8800000-0000-0000-0000-00000000000a', '0088 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8800000-0000-0000-0000-000000000001', 'vet', 'f8800000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f8800000-0000-0000-0000-000000000002', 'vet', 'f8800000-0000-0000-0000-00000000000a', 'D', 'doctor'),
  ('f8800000-0000-0000-0000-000000000003', 'vet', 'f8800000-0000-0000-0000-00000000000a', 'N', 'nurse'),
  ('f8800000-0000-0000-0000-000000000004', 'vet', 'f8800000-0000-0000-0000-00000000000a', 'M', 'manager');
delete from staff_branches where profile_id::text like 'f8800000-%';
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f8800000-0000-0000-0000-000000000001', 'f8800000-0000-0000-0000-000000000002', 'f8800000-0000-0000-0000-000000000003']::uuid[]) p
  where b.clinic_id = 'f8800000-0000-0000-0000-00000000000a';
insert into owner_files (id, clinic_id, name) values
  ('f8800000-0000-0000-0000-0000000000f1', 'f8800000-0000-0000-0000-00000000000a', 'Keep'),
  ('f8800000-0000-0000-0000-0000000000f2', 'f8800000-0000-0000-0000-00000000000a', 'Remove');
insert into pets (id, clinic_id, name, species, owner_name, owner_file_id) values
  ('f8800000-0000-0000-0000-0000000000c1', 'f8800000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Keep', 'f8800000-0000-0000-0000-0000000000f1');
insert into appointments (id, clinic_id, pet_id, scheduled_at, branch_id, created_by, status)
  select 'f8800000-0000-0000-0000-0000000000a1', 'f8800000-0000-0000-0000-00000000000a', 'f8800000-0000-0000-0000-0000000000c1', now(), id, 'f8800000-0000-0000-0000-000000000001', 'in_session'
  from branches where clinic_id = 'f8800000-0000-0000-0000-00000000000a' and is_main;
select set_config('check.branch', (select id::text from branches where clinic_id = 'f8800000-0000-0000-0000-00000000000a' and is_main), true);

set local role authenticated;

-- (a) Receptionist tops up both owners; balance lives in owner_balances.
select set_config('request.jwt.claims', json_build_object('sub', 'f8800000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  perform public.add_owner_balance('f8800000-0000-0000-0000-0000000000f1', 100, 'cash', null, current_setting('check.branch')::uuid);
  perform public.add_owner_balance('f8800000-0000-0000-0000-0000000000f2', 40, 'cash', null, current_setting('check.branch')::uuid);
  assert (select balance = 100 from owner_balances where owner_file_id = 'f8800000-0000-0000-0000-0000000000f1'), 'receptionist must see the balance';
  -- (e) no branch: refused.
  begin
    perform public.add_owner_balance('f8800000-0000-0000-0000-0000000000f1', 5, 'cash', null, null);
    assert false, 'a balance entry without a branch must be refused';
  exception when raise_exception then null;
  end;
end $$;

-- (a) Doctor can't read balances (and owner_files has no balance column any more).
select set_config('request.jwt.claims', json_build_object('sub', 'f8800000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from owner_balances where clinic_id = 'f8800000-0000-0000-0000-00000000000a') = 0, 'doctor must not read balances';
  assert not exists (select 1 from information_schema.columns where table_name = 'owner_files' and column_name = 'balance'), 'owner_files.balance must be gone';
end $$;

-- (a) Manager merges: balances add up; spending more than the balance is refused.
select set_config('request.jwt.claims', json_build_object('sub', 'f8800000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
do $$
begin
  perform public.merge_owner_files('f8800000-0000-0000-0000-0000000000f1', 'f8800000-0000-0000-0000-0000000000f2');
  assert (select balance = 140 from owner_balances where owner_file_id = 'f8800000-0000-0000-0000-0000000000f1'), 'merge must add the balances';
  begin
    perform public.add_owner_balance('f8800000-0000-0000-0000-0000000000f1', -150, null, 'too much', current_setting('check.branch')::uuid);
    assert false, 'balance must never go below 0';
  exception when raise_exception then null;
  end;
end $$;

-- (b) Nurse can't write the old Notes field. (d) One record per visit.
select set_config('request.jwt.claims', json_build_object('sub', 'f8800000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into medical_records (pet_id, clinic_id, branch_id, appointment_id, notes)
      values ('f8800000-0000-0000-0000-0000000000c1', 'f8800000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid, 'f8800000-0000-0000-0000-0000000000a1', 'Diagnosis in notes');
    assert false, 'nurse must not write Notes';
  exception when raise_exception then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'f8800000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  insert into medical_records (pet_id, clinic_id, branch_id, appointment_id, presenting_complaint)
    values ('f8800000-0000-0000-0000-0000000000c1', 'f8800000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid, 'f8800000-0000-0000-0000-0000000000a1', 'first');
  begin
    insert into medical_records (pet_id, clinic_id, branch_id, appointment_id, presenting_complaint)
      values ('f8800000-0000-0000-0000-0000000000c1', 'f8800000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid, 'f8800000-0000-0000-0000-0000000000a1', 'second');
    assert false, 'a visit must have one record';
  exception when unique_violation then null;
  end;
end $$;

rollback;
