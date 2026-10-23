-- Checks for migration 0067 (vaccines). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0067_vaccines_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f6700000-0000-0000-0000-000000000001', 'vx1@check.local', 'authenticated', 'authenticated'),
  ('f6700000-0000-0000-0000-000000000002', 'vx2@check.local', 'authenticated', 'authenticated'),
  ('f6700000-0000-0000-0000-000000000003', 'vx3@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f6700000-0000-0000-0000-00000000000a', 'Vaccine check A'),
  ('f6700000-0000-0000-0000-00000000000b', 'Vaccine check B');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6700000-0000-0000-0000-000000000001', 'vet', 'f6700000-0000-0000-0000-00000000000a', 'V Manager', 'manager'),
  ('f6700000-0000-0000-0000-000000000002', 'vet', 'f6700000-0000-0000-0000-00000000000a', 'V Nurse', 'nurse'),
  ('f6700000-0000-0000-0000-000000000003', 'vet', 'f6700000-0000-0000-0000-00000000000b', 'Other clinic', 'manager');
insert into staff_branches (profile_id, branch_id)
  select 'f6700000-0000-0000-0000-000000000002', id from branches where clinic_id = 'f6700000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f6700000-0000-0000-0000-0000000000a1', 'f6700000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'Owner');

set local role authenticated;

-- Manager adds vaccines; the nurse can read but not add.
select set_config('request.jwt.claims', json_build_object('sub', 'f6700000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into vaccines (id, clinic_id, name, interval_days) values
  ('f6700000-0000-0000-0000-0000000000c1', 'f6700000-0000-0000-0000-00000000000a', 'Rabies', 365),
  ('f6700000-0000-0000-0000-0000000000c2', 'f6700000-0000-0000-0000-00000000000a', 'Combo', 30);

select set_config('request.jwt.claims', json_build_object('sub', 'f6700000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_due date;
  v_dose uuid;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  assert (select count(*) from vaccines) = 2, 'nurse must see the clinic vaccine list';
  begin
    insert into vaccines (clinic_id, name, interval_days) values ('f6700000-0000-0000-0000-00000000000a', 'Nope', 10);
    assert false, 'nurse must not add vaccines';
  exception when insufficient_privilege then null;
  end;

  -- Nurse schedules two vaccines; the pet cache shows the earliest.
  insert into pet_vaccines (id, clinic_id, pet_id, vaccine_id, interval_days, next_due_date) values
    ('f6700000-0000-0000-0000-0000000000d1', 'f6700000-0000-0000-0000-00000000000a', 'f6700000-0000-0000-0000-0000000000a1',
     'f6700000-0000-0000-0000-0000000000c1', 365, v_today + 30),
    ('f6700000-0000-0000-0000-0000000000d2', 'f6700000-0000-0000-0000-00000000000a', 'f6700000-0000-0000-0000-0000000000a1',
     'f6700000-0000-0000-0000-0000000000c2', 30, v_today - 2);
  assert (select next_vaccination_date from pets where id = 'f6700000-0000-0000-0000-0000000000a1') = v_today - 2,
    'pet cache must be the earliest due date';

  -- Mark given: clinic today + interval, history row with the old due date.
  v_due := public.mark_vaccine_given('f6700000-0000-0000-0000-0000000000d2');
  assert v_due = v_today + 30, 'next due must be clinic today + interval, got ' || v_due;
  select id into v_dose from vaccine_doses where pet_vaccine_id = 'f6700000-0000-0000-0000-0000000000d2';
  assert (select previous_due_date from vaccine_doses where id = v_dose) = v_today - 2, 'dose must keep the old due date';
  assert (select given_by from vaccine_doses where id = v_dose) = 'f6700000-0000-0000-0000-000000000002', 'dose must record who gave it';
  assert (select next_vaccination_date from pets where id = 'f6700000-0000-0000-0000-0000000000a1') = v_today + 30,
    'pet cache must follow mark given';

  begin
    perform public.mark_vaccine_given('f6700000-0000-0000-0000-0000000000d2', v_today + 1);
    assert false, 'future dose must be refused';
  exception when sqlstate 'P0001' then null;
  end;

  -- A second dose: only the latest can be undone, and undo restores its due date.
  perform public.mark_vaccine_given('f6700000-0000-0000-0000-0000000000d2', v_today);
  begin
    perform public.undo_vaccine_dose(v_dose);
    assert false, 'an older dose must not be undoable';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.undo_vaccine_dose((select id from vaccine_doses where pet_vaccine_id = 'f6700000-0000-0000-0000-0000000000d2'
                                     order by created_at desc, id desc limit 1));
  assert (select next_due_date from pet_vaccines where id = 'f6700000-0000-0000-0000-0000000000d2') = v_today + 30,
    'undo must restore the previous due date';

  begin
    insert into vaccine_doses (clinic_id, pet_vaccine_id, given_on, previous_due_date)
      values ('f6700000-0000-0000-0000-00000000000a', 'f6700000-0000-0000-0000-0000000000d2', v_today, v_today);
    assert false, 'doses must not be written directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Another clinic sees none of it and can't mark it.
select set_config('request.jwt.claims', json_build_object('sub', 'f6700000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from vaccines) = 0 and (select count(*) from pet_vaccines) = 0 and (select count(*) from vaccine_doses) = 0,
    'other clinic must see no vaccines, schedules or doses';
  begin
    perform public.mark_vaccine_given('f6700000-0000-0000-0000-0000000000d1');
    assert false, 'other clinic must not mark a dose';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- A vaccine in use can't be deleted (manager).
select set_config('request.jwt.claims', json_build_object('sub', 'f6700000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    delete from vaccines where id = 'f6700000-0000-0000-0000-0000000000c1';
    assert false, 'a vaccine in use must not be deletable';
  exception when foreign_key_violation then null;
  end;
end $$;

reset role;
rollback;
select '0067 vaccines: all checks passed' as result;
