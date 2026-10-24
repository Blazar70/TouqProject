-- Checks for migration 0080 (manager overview). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0080_manager_overview_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 whole-clinic manager, 2 branch manager (Main), 3 receptionist (Main).
insert into auth.users (id, email, aud, role) values
  ('f8000000-0000-0000-0000-000000000001', 'm80@check.local', 'authenticated', 'authenticated'),
  ('f8000000-0000-0000-0000-000000000002', 'bm80@check.local', 'authenticated', 'authenticated'),
  ('f8000000-0000-0000-0000-000000000003', 'r80@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f8000000-0000-0000-0000-00000000000a', '0080 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8000000-0000-0000-0000-000000000001', 'vet', 'f8000000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f8000000-0000-0000-0000-000000000002', 'vet', 'f8000000-0000-0000-0000-00000000000a', 'BM', 'manager'),
  ('f8000000-0000-0000-0000-000000000003', 'vet', 'f8000000-0000-0000-0000-00000000000a', 'R', 'receptionist');
delete from staff_branches where profile_id::text like 'f8000000-%';
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f8000000-0000-0000-0000-000000000002', 'f8000000-0000-0000-0000-000000000003']::uuid[]) p
  where b.clinic_id = 'f8000000-0000-0000-0000-00000000000a';
insert into admin_audit_log (actor_name, action, target_type, target_label, clinic_id) values
  ('M', 'discount_given', 'invoice', 'mine', 'f8000000-0000-0000-0000-00000000000a'),
  ('X', 'discount_given', 'invoice', 'other clinic', (select id from clinics where id <> 'f8000000-0000-0000-0000-00000000000a' limit 1)),
  ('A', 'password_reset', 'profile', 'no clinic', null);

set local role authenticated;

-- Whole-clinic manager: own clinic's log only; counts 80 cash with nothing taken -> difference 80.
select set_config('request.jwt.claims', json_build_object('sub', 'f8000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into cash_counts (clinic_id, branch_id, day, counted)
  select 'f8000000-0000-0000-0000-00000000000a', b.id, (now() at time zone 'Asia/Riyadh')::date, 80
  from branches b where b.clinic_id = 'f8000000-0000-0000-0000-00000000000a';
do $$
declare r record;
begin
  assert (select count(*) from admin_audit_log) = 1, 'whole-clinic manager sees only own clinic rows';
  assert (select target_label from admin_audit_log) = 'mine', 'the own row';
  select * into r from report_cash_differences((now() at time zone 'Asia/Riyadh')::date - 1, (now() at time zone 'Asia/Riyadh')::date);
  assert r.counted = 80 and r.expected = 0 and r.difference = 80 and r.counts = 1, format('cash difference row: %s', r);
  assert r.counter_name = 'M', 'counter name';
end $$;

-- Branch manager: no log rows, but the cash report works.
select set_config('request.jwt.claims', json_build_object('sub', 'f8000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from admin_audit_log) = 0, 'branch manager must not read the log';
  assert (select count(*) from report_cash_differences((now() at time zone 'Asia/Riyadh')::date, (now() at time zone 'Asia/Riyadh')::date)) = 1, 'branch manager sees cash differences';
end $$;

-- Receptionist: neither.
select set_config('request.jwt.claims', json_build_object('sub', 'f8000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from admin_audit_log) = 0, 'receptionist must not read the log';
  begin
    perform report_cash_differences(current_date, current_date);
    assert false, 'receptionist must be refused';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

reset role;
rollback;
select '0080 manager overview: all checks passed' as result;
