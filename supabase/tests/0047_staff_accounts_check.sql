-- Checks for migration 0047 (staff accounts). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0047_staff_accounts_check.sql
-- One transaction, rolled back at the end; needs two clinics with a manager
-- each (the staging seed). A failed assert stops with its message.

begin;

do $$
declare
  clinic_a uuid;
  clinic_b uuid;
  mgr uuid;
  doc_b uuid;
  extra_branch uuid;
  n int;
begin
  assert to_regclass('public.caregivers') is null, 'caregivers still exists';
  assert not exists (select 1 from information_schema.columns where table_name = 'appointments' and column_name = 'assigned_staff_id'),
    'assigned_staff_id still exists';
  -- (0047 removed managers' branch rows; branch managers made since then have them on purpose.)

  select clinic_id, id into clinic_a, mgr from profiles where clinic_role = 'manager' order by created_at limit 1;
  select clinic_id, id into clinic_b, doc_b from profiles where role = 'vet' and clinic_id <> clinic_a limit 1;
  assert clinic_b is not null, 'need a second clinic with an account';

  -- usernames: format and uniqueness (as the service role, past the guard)
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update profiles set username = 'dr.ahmed_1' where id = mgr;
  begin
    update profiles set username = 'Dr.Ahmed' where id = mgr;
    assert false, 'uppercase username accepted';
  exception when check_violation then null;
  end;
  begin
    update profiles set username = 'ab' where id = mgr;
    assert false, 'two-letter username accepted';
  exception when check_violation then null;
  end;
  begin
    update profiles set username = 'dr.ahmed_1' where id = doc_b;
    assert false, 'duplicate username accepted';
  exception when unique_violation then null;
  end;

  -- doctor_id must be a profile of the appointment's clinic
  begin
    update appointments set doctor_id = doc_b where clinic_id = clinic_a;
    if found then assert false, 'cross-clinic doctor_id accepted'; end if;
  exception when foreign_key_violation then null;
  end;

  -- profile guard: a signed-in non-admin cannot change username / role ...
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  begin
    update profiles set username = 'self.renamed' where id = mgr;
    assert false, 'non-admin changed own username';
  exception when raise_exception then null;
  end;

  -- ... per-branch managers: no rows = every active branch, rows = only those
  insert into branches (clinic_id, name) values (clinic_a, 'Check branch') returning id into extra_branch;
  select count(*) into n from current_user_branch_ids();
  assert n = (select count(*) from branches where clinic_id = clinic_a and active), 'clinic manager does not see all branches';
  insert into staff_branches values (mgr, extra_branch);
  select count(*) into n from current_user_branch_ids();
  assert n = 1, 'branch manager sees more than their branch';

  -- ... while the service role (edge functions) can.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update profiles set clinic_role = 'doctor', username = 'svc.changed' where id = mgr;
  assert (select clinic_role from profiles where id = mgr) = 'doctor', 'service role blocked by profile guard';

  raise notice '0047 checks passed';
end $$;

rollback;
