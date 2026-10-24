-- Checks for migration 0073. RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0073_cash_count_history_time_off_arrived_check.sql
begin;

insert into auth.users (id, email, aud, role) values
  ('f7300000-0000-0000-0000-000000000001', 'r73@check.local', 'authenticated', 'authenticated'),
  ('f7300000-0000-0000-0000-000000000002', 'm73@check.local', 'authenticated', 'authenticated'),
  ('f7300000-0000-0000-0000-000000000003', 'd73@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f7300000-0000-0000-0000-00000000000a', '0073 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f7300000-0000-0000-0000-000000000001', 'vet', 'f7300000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f7300000-0000-0000-0000-000000000002', 'vet', 'f7300000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f7300000-0000-0000-0000-000000000003', 'vet', 'f7300000-0000-0000-0000-00000000000a', 'D', 'doctor');
delete from staff_branches where profile_id::text like 'f7300000-%';
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f7300000-0000-0000-0000-000000000001', 'f7300000-0000-0000-0000-000000000003']::uuid[]) p
  where b.clinic_id = 'f7300000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f7300000-0000-0000-0000-0000000000c1', 'f7300000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');
insert into appointments (id, pet_id, clinic_id, created_by, doctor_id, scheduled_at, status) values
  ('f7300000-0000-0000-0000-0000000000a1', 'f7300000-0000-0000-0000-0000000000c1', 'f7300000-0000-0000-0000-00000000000a', 'f7300000-0000-0000-0000-000000000002', 'f7300000-0000-0000-0000-000000000003', '2030-01-10 11:30+03', 'arrived');

set local role authenticated;

-- S8: a recount adds a row; nobody can overwrite a count.
select set_config('request.jwt.claims', json_build_object('sub', 'f7300000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_branch uuid := (select id from branches where clinic_id = 'f7300000-0000-0000-0000-00000000000a' and is_main);
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  insert into cash_counts (clinic_id, branch_id, day, counted) values ('f7300000-0000-0000-0000-00000000000a', v_branch, v_today, 1450);
  insert into cash_counts (clinic_id, branch_id, day, counted) values ('f7300000-0000-0000-0000-00000000000a', v_branch, v_today, 1500);
  assert (select count(*) from cash_counts where branch_id = v_branch and day = v_today) = 2, 'both counts must be kept';
  begin
    update cash_counts set counted = 0 where branch_id = v_branch;
    assert false, 'a count must not be overwritten';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from cash_counts where branch_id = v_branch;
    assert false, 'a count must not be deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6a: nobody calls default_invoice_code directly; the branch trigger still fills the code.
do $$
begin
  begin
    perform default_invoice_code('f7300000-0000-0000-0000-00000000000a', 'X');
    assert false, 'default_invoice_code must not be callable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B8: time off moves an arrived appointment to Unassigned.
select set_config('request.jwt.claims', json_build_object('sub', 'f7300000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  assert save_doctor_time_off(null, 'f7300000-0000-0000-0000-000000000003', '2030-01-10 11:00+03', '2030-01-10 23:00+03', 'Sick') = 1,
    'time off must move the arrived appointment';
  assert (select doctor_id from appointments where id = 'f7300000-0000-0000-0000-0000000000a1') is null, 'arrived appointment still has the doctor';
end $$;

reset role;
insert into branches (clinic_id, name) values ('f7300000-0000-0000-0000-00000000000a', 'Second');
do $$ begin
  assert (select invoice_code from branches where clinic_id = 'f7300000-0000-0000-0000-00000000000a' and name = 'Second') = 'SECOND',
    'branch trigger must still set the invoice code';
end $$;

rollback;
select '0073: all checks passed' as result;
