-- Checks for migration 0071 (cash counts). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0071_cash_counts_check.sql
begin;

insert into auth.users (id, email, aud, role) values
  ('f7100000-0000-0000-0000-000000000001', 'cc1@check.local', 'authenticated', 'authenticated'),
  ('f7100000-0000-0000-0000-000000000002', 'cc2@check.local', 'authenticated', 'authenticated'),
  ('f7100000-0000-0000-0000-000000000003', 'cc3@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f7100000-0000-0000-0000-00000000000a', 'Cash count check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f7100000-0000-0000-0000-000000000001', 'vet', 'f7100000-0000-0000-0000-00000000000a', 'C Reception', 'receptionist'),
  ('f7100000-0000-0000-0000-000000000002', 'vet', 'f7100000-0000-0000-0000-00000000000a', 'C Manager', 'manager'),
  ('f7100000-0000-0000-0000-000000000003', 'vet', 'f7100000-0000-0000-0000-00000000000a', 'C Doctor', 'doctor');
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f7100000-0000-0000-0000-000000000001', 'f7100000-0000-0000-0000-000000000003']::uuid[]) p
  where b.clinic_id = 'f7100000-0000-0000-0000-00000000000a';

set local role authenticated;

-- Reception counts today, corrects it the same day; can't touch yesterday.
select set_config('request.jwt.claims', json_build_object('sub', 'f7100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_branch uuid := (select id from branches where clinic_id = 'f7100000-0000-0000-0000-00000000000a' and is_main);
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  insert into cash_counts (clinic_id, branch_id, day, counted) values ('f7100000-0000-0000-0000-00000000000a', v_branch, v_today, 500);
  insert into cash_counts (clinic_id, branch_id, day, counted) values ('f7100000-0000-0000-0000-00000000000a', v_branch, v_today, 480);
  -- 0073: a recount adds a row (history); the page shows the latest.
  assert (select count(*) from cash_counts where branch_id = v_branch and day = v_today) = 2, 'a recount must keep the earlier count';
  assert (select bool_and(counted_by = 'f7100000-0000-0000-0000-000000000001') from cash_counts where branch_id = v_branch and day = v_today), 'who counted must be recorded';
  begin
    insert into cash_counts (clinic_id, branch_id, day, counted) values ('f7100000-0000-0000-0000-00000000000a', v_branch, v_today - 1, 10);
    assert false, 'reception must not write an earlier day';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- Manager may correct an earlier day; a doctor may not count.
select set_config('request.jwt.claims', json_build_object('sub', 'f7100000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
insert into cash_counts (clinic_id, branch_id, day, counted)
  select 'f7100000-0000-0000-0000-00000000000a', id, (now() at time zone 'Asia/Riyadh')::date - 1, 300
  from branches where clinic_id = 'f7100000-0000-0000-0000-00000000000a' and is_main;

select set_config('request.jwt.claims', json_build_object('sub', 'f7100000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into cash_counts (clinic_id, branch_id, day, counted)
      select 'f7100000-0000-0000-0000-00000000000a', id, (now() at time zone 'Asia/Riyadh')::date, 1
      from branches where clinic_id = 'f7100000-0000-0000-0000-00000000000a' and is_main;
    assert false, 'a doctor must not count cash';
  exception when sqlstate 'P0001' then null;
  end;
  assert (select count(*) from cash_counts) = 0, 'a doctor must not see cash counts (0074: reception and managers only)';
end $$;

reset role;
rollback;
select '0071 cash counts: all checks passed' as result;
