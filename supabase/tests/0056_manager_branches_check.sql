-- Checks for migration 0056 (managers manage branches). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0056_manager_branches_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f5600000-0000-0000-0000-000000000001', 'm1@check.local', 'authenticated', 'authenticated'),
  ('f5600000-0000-0000-0000-000000000002', 'bm1@check.local', 'authenticated', 'authenticated'),
  ('f5600000-0000-0000-0000-000000000003', 'd1@check.local', 'authenticated', 'authenticated'),
  ('f5600000-0000-0000-0000-000000000004', 'om1@check.local', 'authenticated', 'authenticated');

-- The clinic insert trigger (0044) adds each clinic's Main branch.
insert into clinics (id, name) values
  ('f5600000-0000-0000-0000-00000000000a', 'Branch check A'),
  ('f5600000-0000-0000-0000-00000000000b', 'Branch check B');
insert into branches (id, clinic_id, name) values
  ('f5600000-0000-0000-0000-0000000000b1', 'f5600000-0000-0000-0000-00000000000a', 'North'),
  ('f5600000-0000-0000-0000-0000000000b2', 'f5600000-0000-0000-0000-00000000000a', 'East');

insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f5600000-0000-0000-0000-000000000001', 'vet', 'f5600000-0000-0000-0000-00000000000a', 'Whole manager', 'manager'),
  ('f5600000-0000-0000-0000-000000000002', 'vet', 'f5600000-0000-0000-0000-00000000000a', 'North manager', 'manager'),
  ('f5600000-0000-0000-0000-000000000003', 'vet', 'f5600000-0000-0000-0000-00000000000a', 'North doctor', 'doctor'),
  ('f5600000-0000-0000-0000-000000000004', 'vet', 'f5600000-0000-0000-0000-00000000000b', 'Other manager', 'manager');
delete from staff_branches where profile_id in (
  'f5600000-0000-0000-0000-000000000001', 'f5600000-0000-0000-0000-000000000002',
  'f5600000-0000-0000-0000-000000000003', 'f5600000-0000-0000-0000-000000000004');
insert into staff_branches (profile_id, branch_id) values
  ('f5600000-0000-0000-0000-000000000002', 'f5600000-0000-0000-0000-0000000000b1'),
  ('f5600000-0000-0000-0000-000000000003', 'f5600000-0000-0000-0000-0000000000b1');

set local role authenticated;

-- Branch manager (North): edits North's details; nothing else.
select set_config('request.jwt.claims', json_build_object('sub', 'f5600000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$ begin
  assert not current_user_is_clinic_manager(), 'branch manager counted as whole-clinic manager';
  update branches set name = 'North 2', phone = '0500000000', address = 'x', name_ar = 'ش' where id = 'f5600000-0000-0000-0000-0000000000b1';
  assert found, 'branch manager could not edit own branch';
  update branches set name = 'East 2' where id = 'f5600000-0000-0000-0000-0000000000b2';
  assert not found, 'branch manager edited another branch';
  begin
    update branches set active = false where id = 'f5600000-0000-0000-0000-0000000000b1';
    raise exception 'branch manager closed own branch';
  exception when raise_exception then
    if sqlerrm like 'branch manager%' then raise; end if;
  end;
  begin
    perform admin_set_main_branch('f5600000-0000-0000-0000-0000000000b1');
    raise exception 'branch manager made a branch main';
  exception when raise_exception then
    if sqlerrm like 'branch manager%' then raise; end if;
  end;
  begin
    perform admin_close_branch('f5600000-0000-0000-0000-0000000000b2');
    raise exception 'branch manager closed a branch';
  exception when raise_exception then
    if sqlerrm like 'branch manager%' then raise; end if;
  end;
  begin
    insert into branches (clinic_id, name) values ('f5600000-0000-0000-0000-00000000000a', 'West');
    raise exception 'branch manager added a branch';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Doctor: no branch writes.
select set_config('request.jwt.claims', json_build_object('sub', 'f5600000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$ begin
  update branches set name = 'North 3' where id = 'f5600000-0000-0000-0000-0000000000b1';
  assert not found, 'doctor edited a branch';
end $$;

-- Other clinic's manager: can't touch clinic A.
select set_config('request.jwt.claims', json_build_object('sub', 'f5600000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
do $$ begin
  update branches set name = 'Hijack' where id = 'f5600000-0000-0000-0000-0000000000b2';
  assert not found, 'other clinic manager edited a branch';
  begin
    perform admin_set_main_branch('f5600000-0000-0000-0000-0000000000b2');
    raise exception 'other clinic manager made a branch main';
  exception when raise_exception then
    if sqlerrm like 'other clinic%' then raise; end if;
  end;
  begin
    insert into branches (clinic_id, name) values ('f5600000-0000-0000-0000-00000000000a', 'Hijack');
    raise exception 'other clinic manager added a branch';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Whole-clinic manager: add, edit, make main, close (moves the doctor), reopen.
select set_config('request.jwt.claims', json_build_object('sub', 'f5600000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  moved integer;
begin
  assert current_user_is_clinic_manager(), 'whole-clinic manager not recognised';
  insert into branches (clinic_id, name) values ('f5600000-0000-0000-0000-00000000000a', 'West');
  update branches set name = 'East 3' where id = 'f5600000-0000-0000-0000-0000000000b2';
  assert found, 'manager could not edit a branch';
  perform admin_set_main_branch('f5600000-0000-0000-0000-0000000000b2');
  assert (select is_main from branches where id = 'f5600000-0000-0000-0000-0000000000b2'), 'make main did not apply';
  moved := admin_close_branch('f5600000-0000-0000-0000-0000000000b1');
  assert moved = 2, format('expected 2 staff moved, got %s', moved);
  assert exists (select 1 from staff_branches where profile_id = 'f5600000-0000-0000-0000-000000000003' and branch_id = 'f5600000-0000-0000-0000-0000000000b2'),
    'doctor not moved to the new main';
  update branches set active = true where id = 'f5600000-0000-0000-0000-0000000000b1';
  assert found, 'manager could not reopen';
  begin
    insert into branches (clinic_id, name) values ('f5600000-0000-0000-0000-00000000000b', 'Hijack');
    raise exception 'manager added a branch to another clinic';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'all 0056 checks passed' as result;
rollback;
