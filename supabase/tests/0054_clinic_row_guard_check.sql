-- Checks for migration 0054 (clinic row guard). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0054_clinic_row_guard_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f5400000-0000-0000-0000-000000000001', 'gx1@check.local', 'authenticated', 'authenticated'),
  ('f5400000-0000-0000-0000-000000000002', 'ga1@check.local', 'authenticated', 'authenticated');

insert into clinics (id, name) values ('f5400000-0000-0000-0000-00000000000a', 'Guard X');

insert into profiles (id, role, clinic_id, full_name, clinic_role, disabled) values
  ('f5400000-0000-0000-0000-000000000001', 'vet', 'f5400000-0000-0000-0000-00000000000a', 'X doctor', 'doctor', false);
insert into profiles (id, role, full_name) values
  ('f5400000-0000-0000-0000-000000000002', 'admin', 'Check admin');

set local role authenticated;

-- Doctor: name and phone yes; billing, disabled, deleted_at, timezone no
select set_config('request.jwt.claims', json_build_object('sub', 'f5400000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  forbidden text;
begin
  update clinics set name = 'Guard X2', phone = '0500000000' where id = 'f5400000-0000-0000-0000-00000000000a';
  assert found, 'doctor could not change name/phone';
  foreach forbidden in array array[
    'billing_status = ''trial''', 'disabled = true', 'deleted_at = now()', 'timezone = ''UTC'''
  ] loop
    begin
      execute format('update clinics set %s where id = %L', forbidden, 'f5400000-0000-0000-0000-00000000000a');
      raise exception 'doctor changed: %', forbidden;
    exception when raise_exception then
      if sqlerrm like 'doctor changed:%' then raise; end if;
    end;
  end loop;
end $$;

-- Admin: anything
select set_config('request.jwt.claims', json_build_object('sub', 'f5400000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$ begin
  update clinics set billing_status = 'trial', disabled = true where id = 'f5400000-0000-0000-0000-00000000000a';
  assert found, 'admin could not change billing/disabled';
end $$;

reset role;
select 'all 0054 checks passed' as result;
rollback;
