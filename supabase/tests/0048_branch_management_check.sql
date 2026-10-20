-- Checks for migration 0048 (branch management). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0048_branch_management_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

do $$
declare
  v_clinic uuid;
  v_main uuid;
  v_admin uuid;
  v_other uuid;
  v_only uuid;
  v_both uuid;
  v_moved int;
begin
  select clinic_id, id into v_clinic, v_main from branches where is_main limit 1;
  select id into v_admin from profiles where role = 'admin' and not disabled limit 1;
  assert v_admin is not null, 'need an admin profile';

  -- duplicate names (any case) refused
  begin
    insert into branches (clinic_id, name) select v_clinic, upper(name) from branches where id = v_main;
    assert false, 'duplicate branch name accepted';
  exception when unique_violation then null;
  end;

  -- non-admins cannot use the functions
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform admin_set_main_branch(v_main);
    assert false, 'non-admin changed the main branch';
  exception when raise_exception then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  insert into branches (clinic_id, name) values (v_clinic, 'Check Other') returning id into v_other;

  -- the main branch cannot be closed
  begin
    perform admin_close_branch(v_main);
    assert false, 'main branch closed';
  exception when raise_exception then null;
  end;

  -- make main swaps cleanly, then back
  perform admin_set_main_branch(v_other);
  assert (select count(*) from branches where clinic_id = v_clinic and is_main) = 1, 'not exactly one main';
  assert (select is_main from branches where id = v_other), 'make main did not move';
  perform admin_set_main_branch(v_main);

  -- closing moves staff who only work there; others just lose it
  select id into v_only from profiles where clinic_id = v_clinic and role = 'vet' order by created_at limit 1;
  select id into v_both from profiles where clinic_id = v_clinic and role = 'vet' and id <> v_only order by created_at limit 1;
  assert v_both is not null, 'need two clinic accounts';
  delete from staff_branches where profile_id in (v_only, v_both);
  insert into staff_branches values (v_only, v_other), (v_both, v_other), (v_both, v_main);

  v_moved := admin_close_branch(v_other);
  assert v_moved = 1, 'expected exactly one staff member moved, got ' || v_moved;
  assert exists (select 1 from staff_branches where profile_id = v_only and branch_id = v_main), 'only-branch staff not moved to main';
  assert not exists (select 1 from staff_branches where branch_id = v_other), 'closed branch still has staff';
  assert not (select active from branches where id = v_other), 'branch not closed';

  -- the main branch can never be inactive
  begin
    update branches set active = false where id = v_main;
    assert false, 'main branch deactivated directly';
  exception when check_violation then null;
  end;

  raise notice '0048 checks passed';
end $$;

rollback;
