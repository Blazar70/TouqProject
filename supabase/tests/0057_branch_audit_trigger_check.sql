-- Checks for migration 0057 (branch changes logged by the database). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0057_branch_audit_trigger_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f5700000-0000-0000-0000-000000000001', 'bm1@check.local', 'authenticated', 'authenticated');
-- The clinic's automatic Main branch is created with no signed-in user: not logged.
insert into clinics (id, name) values ('f5700000-0000-0000-0000-00000000000a', 'Audit X');
insert into profiles (id, role, clinic_id, full_name, clinic_role, disabled) values
  ('f5700000-0000-0000-0000-000000000001', 'vet', 'f5700000-0000-0000-0000-00000000000a', 'X Manager', 'manager', false);

-- A whole-clinic manager (no branch rows) does every kind of change.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f5700000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_branch uuid;
begin
  insert into branches (clinic_id, name) values ('f5700000-0000-0000-0000-00000000000a', 'Audit East') returning id into v_branch;
  update branches set phone = '0500000001' where id = v_branch;
  perform public.admin_close_branch(v_branch);
  update branches set active = true where id = v_branch;
  perform public.admin_set_main_branch(v_branch);
  update clinics set logo_url = 'f5700000-0000-0000-0000-00000000000a/logo.png' where id = 'f5700000-0000-0000-0000-00000000000a';
  update clinics set logo_url = null where id = 'f5700000-0000-0000-0000-00000000000a';
end $$;

reset role;
do $$
declare
  v_actions text[];
begin
  -- One transaction gives every row the same created_at, so compare sorted.
  select array_agg(action order by action) into v_actions
  from admin_audit_log where clinic_id = 'f5700000-0000-0000-0000-00000000000a';
  assert v_actions = array['branch_added', 'branch_closed', 'branch_made_main', 'branch_reopened', 'branch_updated',
                           'clinic_logo_changed', 'clinic_logo_removed'],
    'unexpected log: ' || coalesce(v_actions::text, 'none');
  assert not exists (select 1 from admin_audit_log where clinic_id = 'f5700000-0000-0000-0000-00000000000a' and actor_name <> 'X Manager'),
    'actor name wrong';
end $$;

select 'all 0057 checks passed' as result;
rollback;
