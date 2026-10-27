-- Checks for migration 0091 (only a manager picks the hospital night service). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0091_hospital_night_manager_only_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 receptionist, 2 manager.
insert into auth.users (id, email, aud, role) values
  ('f9100000-0000-0000-0000-000000000001', 'r91@check.local', 'authenticated', 'authenticated'),
  ('f9100000-0000-0000-0000-000000000002', 'm91@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f9100000-0000-0000-0000-00000000000a', '0091 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f9100000-0000-0000-0000-000000000001', 'vet', 'f9100000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f9100000-0000-0000-0000-000000000002', 'vet', 'f9100000-0000-0000-0000-00000000000a', 'M', 'manager');
-- Inserted with no login (auth.uid() null), like a job: allowed.
insert into services (id, clinic_id, name, price, hospital_night) values
  ('f9100000-0000-0000-0000-0000000000e1', 'f9100000-0000-0000-0000-00000000000a', 'Night', 200, true),
  ('f9100000-0000-0000-0000-0000000000e2', 'f9100000-0000-0000-0000-00000000000a', 'Cheap', 10, false);

set local role authenticated;

-- Receptionist: may edit prices, may not move, clear or delete the hospital night.
select set_config('request.jwt.claims', json_build_object('sub', 'f9100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  update services set price = 220 where id = 'f9100000-0000-0000-0000-0000000000e1';
  assert (select price = 220 from services where id = 'f9100000-0000-0000-0000-0000000000e1'), 'price edit stays open to all staff';
  begin
    update services set hospital_night = false where id = 'f9100000-0000-0000-0000-0000000000e1';
    assert false, 'receptionist must not clear the hospital night';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from services where id = 'f9100000-0000-0000-0000-0000000000e1';
    assert false, 'receptionist must not delete the hospital night service';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into services (clinic_id, name, price, hospital_night) values ('f9100000-0000-0000-0000-00000000000a', 'Sneaky', 1, true);
    assert false, 'receptionist must not add a hospital night service';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Manager moves it.
select set_config('request.jwt.claims', json_build_object('sub', 'f9100000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  update services set hospital_night = false where id = 'f9100000-0000-0000-0000-0000000000e1';
  update services set hospital_night = true where id = 'f9100000-0000-0000-0000-0000000000e2';
  assert (select hospital_night from services where id = 'f9100000-0000-0000-0000-0000000000e2'), 'manager moves the hospital night';
end $$;

rollback;
