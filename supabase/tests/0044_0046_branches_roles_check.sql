-- Checks for migrations 0044-0046 (branches, clinic roles, branch columns).
-- RUN ON STAGING ONLY, never on live:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0044_0046_branches_roles_check.sql
-- Everything runs in one transaction that is rolled back, so it leaves no
-- data behind and can be re-run. A failed assert stops with its message.

begin;

-- 1. Backfill shape, on whatever data the database already has.
select
  (select count(*) from clinics) as clinics,
  (select count(*) from branches where is_main) as main_branches,
  (select count(*) from staff_branches) as memberships,
  (select count(*) from profiles where role = 'vet') as clinic_accounts,
  (select count(*) from profiles where clinic_role = 'manager') as managers,
  (select count(*) from profiles where clinic_role = 'doctor' and takes_appointments) as doctors_taking_appts,
  (select count(*) from appointments) as appointments,
  (select count(*) from invoices) as invoices;

do $$ begin
  assert not exists (select 1 from clinics c where not exists (select 1 from branches b where b.clinic_id = c.id and b.is_main)),
    'a clinic has no main branch';
  assert not exists (select 1 from profiles where role = 'vet' and clinic_role is null), 'a clinic account has no clinic_role';
  assert not exists (
    select clinic_id from profiles where role = 'vet' group by clinic_id
    having count(*) filter (where clinic_role = 'manager') < 1
  ), 'a clinic with accounts has no manager';
  assert not exists (
    select 1 from appointments a join branches b on b.id = a.branch_id where not b.is_main
  ), 'backfilled appointment not on main branch';
end $$;

-- 2. Fixtures: clinic X (two active branches, one inactive) and clinic Y.
insert into auth.users (id, email, aud, role) values
  ('f0000000-0000-0000-0000-000000000001', 'x1@check.local', 'authenticated', 'authenticated'),
  ('f0000000-0000-0000-0000-000000000002', 'x2@check.local', 'authenticated', 'authenticated'),
  ('f0000000-0000-0000-0000-000000000003', 'x3@check.local', 'authenticated', 'authenticated'),
  ('f0000000-0000-0000-0000-000000000004', 'y1@check.local', 'authenticated', 'authenticated');

-- clinics_create_main_branch must give each new clinic its main branch
insert into clinics (id, name) values
  ('f0000000-0000-0000-0000-00000000000a', 'Check X'),
  ('f0000000-0000-0000-0000-00000000000b', 'Check Y');

insert into branches (id, clinic_id, name, active) values
  ('f0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-00000000000a', 'X second', true),
  ('f0000000-0000-0000-0000-0000000000a3', 'f0000000-0000-0000-0000-00000000000a', 'X closed', false);

-- no clinic_role sent, like admin-manage-clinic today: first becomes manager
insert into profiles (id, role, clinic_id, full_name) values
  ('f0000000-0000-0000-0000-000000000001', 'vet', 'f0000000-0000-0000-0000-00000000000a', 'X1 manager');
insert into profiles (id, role, clinic_id, full_name) values
  ('f0000000-0000-0000-0000-000000000002', 'vet', 'f0000000-0000-0000-0000-00000000000a', 'X2 doctor');
insert into profiles (id, role, clinic_id, full_name, clinic_role, disabled) values
  ('f0000000-0000-0000-0000-000000000003', 'vet', 'f0000000-0000-0000-0000-00000000000a', 'X3 disabled', 'nurse', true);
insert into profiles (id, role, clinic_id, full_name) values
  ('f0000000-0000-0000-0000-000000000004', 'vet', 'f0000000-0000-0000-0000-00000000000b', 'Y1 manager');

insert into staff_branches (profile_id, branch_id)
select p, b.id from branches b,
  unnest(array['f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000003']::uuid[]) p
where b.clinic_id = 'f0000000-0000-0000-0000-00000000000a' and b.is_main;

insert into pets (id, clinic_id, name, species, owner_name, owner_phone) values
  ('f0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-00000000000a', 'Check pet', 'cat', 'Check owner', '0500000009');

do $$
declare x_main uuid := (select id from branches where clinic_id = 'f0000000-0000-0000-0000-00000000000a' and is_main);
begin
  assert x_main is not null, 'new clinic got no main branch';
  assert (select clinic_role from profiles where id = 'f0000000-0000-0000-0000-000000000001') = 'manager', 'first account not manager';
  assert (select clinic_role = 'doctor' and takes_appointments from profiles where id = 'f0000000-0000-0000-0000-000000000002'),
    'second account not a doctor taking appointments';
  assert (select clinic_role from profiles where id = 'f0000000-0000-0000-0000-000000000003') = 'nurse', 'explicit clinic_role overwritten';

  -- 3. fill_default_branch: no branch sent -> main branch
  insert into appointments (pet_id, clinic_id, scheduled_at, created_by) values
    ('f0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-00000000000a', now(), 'f0000000-0000-0000-0000-000000000001');
  assert (select branch_id from appointments where pet_id = 'f0000000-0000-0000-0000-0000000000e1') = x_main,
    'appointment did not get the main branch';
  insert into invoices (clinic_id, pet_id, created_by, method, amount_total) values
    ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-000000000001', 'cash', 10);
  assert (select branch_id from invoices where pet_id = 'f0000000-0000-0000-0000-0000000000e1') = x_main,
    'invoice did not get the main branch';

  -- a branch sent explicitly is kept
  insert into appointments (pet_id, clinic_id, scheduled_at, created_by, branch_id) values
    ('f0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-00000000000a', now() + interval '1 hour',
     'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000a2');
  assert exists (select 1 from appointments where branch_id = 'f0000000-0000-0000-0000-0000000000a2'), 'explicit branch overwritten';

  -- another clinic's branch is rejected by the composite FK
  begin
    insert into appointments (pet_id, clinic_id, scheduled_at, created_by, branch_id)
    select 'f0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-00000000000a', now(),
      'f0000000-0000-0000-0000-000000000001', id
    from branches where clinic_id = 'f0000000-0000-0000-0000-00000000000b' and is_main;
    raise exception 'cross-clinic branch was accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

-- 4. Helpers and RLS as each logged-in user.
set local role authenticated;

-- manager: all ACTIVE branches of X (main + second, not the closed one), no Y branch visible
select set_config('request.jwt.claims', json_build_object('sub', 'f0000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$ begin
  assert current_user_clinic_role() = 'manager', 'manager role';
  assert current_user_has_role(array['manager']) and not current_user_has_role(array['doctor', 'nurse']), 'manager has_role';
  assert (select count(*) from current_user_branch_ids()) = 2, 'manager should get 2 active branches';
  assert (select count(*) from branches) = 3, 'manager should read all 3 X branches';
  assert not exists (select 1 from branches where clinic_id <> 'f0000000-0000-0000-0000-00000000000a'), 'manager sees another clinic''s branch';
  assert not exists (select 1 from staff_branches sb join branches b on b.id = sb.branch_id
    where b.clinic_id <> 'f0000000-0000-0000-0000-00000000000a'), 'manager sees another clinic''s memberships';
end $$;

-- doctor: only the member branch; cannot promote themselves; cannot write branches
select set_config('request.jwt.claims', json_build_object('sub', 'f0000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$ begin
  assert current_user_clinic_role() = 'doctor', 'doctor role';
  assert (select array_agg(id) from current_user_branch_ids() id)
    = (select array_agg(id) from branches where clinic_id = 'f0000000-0000-0000-0000-00000000000a' and is_main), 'doctor branches';
  assert not exists (select 1 from branches where clinic_id <> 'f0000000-0000-0000-0000-00000000000a'), 'doctor sees another clinic''s branch';
  update profiles set last_branch_id = 'f0000000-0000-0000-0000-0000000000a2' where id = auth.uid(); -- allowed
  begin
    update profiles set clinic_role = 'manager' where id = auth.uid();
    raise exception 'doctor promoted themselves';
  exception when raise_exception then
    if sqlerrm = 'doctor promoted themselves' then raise; end if;
  end;
  update branches set name = 'hacked' where clinic_id = 'f0000000-0000-0000-0000-00000000000a';
  assert not found, 'doctor could update a branch';
end $$;

-- disabled user: no role, no branches, no branch rows
select set_config('request.jwt.claims', json_build_object('sub', 'f0000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$ begin
  assert current_user_clinic_role() is null, 'disabled user has a role';
  assert not current_user_has_role(array['nurse']), 'disabled user has_role';
  assert (select count(*) from current_user_branch_ids()) = 0, 'disabled user has branches';
  assert (select count(*) from branches) = 0, 'disabled user reads branches';
end $$;

-- disabled clinic: same for its manager
reset role;
update clinics set disabled = true where id = 'f0000000-0000-0000-0000-00000000000b';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f0000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
do $$ begin
  assert current_user_clinic_role() is null, 'user of disabled clinic has a role';
  assert (select count(*) from current_user_branch_ids()) = 0, 'user of disabled clinic has branches';
end $$;

reset role;
select 'all 0044-0046 checks passed' as result;
rollback;
