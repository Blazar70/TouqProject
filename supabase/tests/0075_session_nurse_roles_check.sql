-- Checks for migration 0075 (sessions and nurse rules). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0075_session_nurse_roles_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f7500000-0000-0000-0000-000000000001', 'd1@check.local', 'authenticated', 'authenticated'),
  ('f7500000-0000-0000-0000-000000000002', 'd2@check.local', 'authenticated', 'authenticated'),
  ('f7500000-0000-0000-0000-000000000003', 'n@check.local', 'authenticated', 'authenticated'),
  ('f7500000-0000-0000-0000-000000000004', 'r@check.local', 'authenticated', 'authenticated'),
  ('f7500000-0000-0000-0000-000000000005', 'm@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f7500000-0000-0000-0000-00000000000a', 'Session roles check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f7500000-0000-0000-0000-000000000001', 'vet', 'f7500000-0000-0000-0000-00000000000a', 'Doctor One', 'doctor'),
  ('f7500000-0000-0000-0000-000000000002', 'vet', 'f7500000-0000-0000-0000-00000000000a', 'Doctor Two', 'doctor'),
  ('f7500000-0000-0000-0000-000000000003', 'vet', 'f7500000-0000-0000-0000-00000000000a', 'Nurse', 'nurse'),
  ('f7500000-0000-0000-0000-000000000004', 'vet', 'f7500000-0000-0000-0000-00000000000a', 'Reception', 'receptionist'),
  ('f7500000-0000-0000-0000-000000000005', 'vet', 'f7500000-0000-0000-0000-00000000000a', 'Manager', 'manager');
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array[
    'f7500000-0000-0000-0000-000000000001', 'f7500000-0000-0000-0000-000000000002', 'f7500000-0000-0000-0000-000000000003',
    'f7500000-0000-0000-0000-000000000004']::uuid[]) p
  where b.clinic_id = 'f7500000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f7500000-0000-0000-0000-0000000000c1', 'f7500000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'Owner'),
  ('f7500000-0000-0000-0000-0000000000c2', 'f7500000-0000-0000-0000-00000000000a', 'Tom', 'cat', 'Owner');
insert into appointments (id, pet_id, clinic_id, branch_id, created_by, scheduled_at, status)
  select x.id, 'f7500000-0000-0000-0000-0000000000c1', 'f7500000-0000-0000-0000-00000000000a', b.id,
    'f7500000-0000-0000-0000-000000000004', now(), 'confirmed'
  from branches b, (values
    ('f7500000-0000-0000-0000-0000000000a1'::uuid), ('f7500000-0000-0000-0000-0000000000a2'::uuid),
    ('f7500000-0000-0000-0000-0000000000a3'::uuid)) x(id)
  where b.clinic_id = 'f7500000-0000-0000-0000-00000000000a';
insert into vaccines (id, clinic_id, name, interval_days) values
  ('f7500000-0000-0000-0000-0000000000e1', 'f7500000-0000-0000-0000-00000000000a', 'Rabies', 365);
insert into pet_vaccines (id, clinic_id, pet_id, vaccine_id, interval_days, next_due_date) values
  ('f7500000-0000-0000-0000-0000000000e2', 'f7500000-0000-0000-0000-00000000000a', 'f7500000-0000-0000-0000-0000000000c1',
   'f7500000-0000-0000-0000-0000000000e1', 365, current_date);

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
set local role authenticated;

-- Reception and managers can't start a session.
do $$
begin
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000004');
  begin
    update appointments set status = 'in_session', started_at = now() where id = 'f7500000-0000-0000-0000-0000000000a1';
    assert false, 'receptionist started a session';
  exception when sqlstate 'P0001' then null;
  end;
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000005');
  begin
    update appointments set status = 'in_session', started_at = now() where id = 'f7500000-0000-0000-0000-0000000000a1';
    assert false, 'manager started a session';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- Doctor One starts a1; the DB stamps him and the client can't change it.
do $$
begin
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000001');
  update appointments set status = 'in_session', started_at = now() where id = 'f7500000-0000-0000-0000-0000000000a1';
  update appointments set started_by = 'f7500000-0000-0000-0000-000000000002', reason = 'x' where id = 'f7500000-0000-0000-0000-0000000000a1';
  assert (select started_by from appointments where id = 'f7500000-0000-0000-0000-0000000000a1') = 'f7500000-0000-0000-0000-000000000001',
    'started_by must be the doctor who started';
end $$;

-- Doctor Two can't resume it: no record writes, no finish.
do $$
begin
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000002');
  assert not public.can_work_session('f7500000-0000-0000-0000-0000000000a1'), 'second doctor can work on the session';
  begin
    insert into medical_records (pet_id, clinic_id, vet_id, appointment_id, visit_type)
      values ('f7500000-0000-0000-0000-0000000000c1', 'f7500000-0000-0000-0000-00000000000a', 'f7500000-0000-0000-0000-000000000002',
              'f7500000-0000-0000-0000-0000000000a1', 'checkup');
    assert false, 'second doctor wrote the session record';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update appointments set status = 'completed' where id = 'f7500000-0000-0000-0000-0000000000a1';
    assert false, 'second doctor finished the session';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- The nurse joins: nurse fields yes, diagnosis/treatment/plan no; she is the record's nurse.
do $$
declare
  v_rec uuid;
begin
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000003');
  begin
    insert into medical_records (pet_id, clinic_id, vet_id, appointment_id, visit_type, diagnosis)
      values ('f7500000-0000-0000-0000-0000000000c1', 'f7500000-0000-0000-0000-00000000000a', 'f7500000-0000-0000-0000-000000000003',
              'f7500000-0000-0000-0000-0000000000a1', 'checkup', 'Otitis');
    assert false, 'nurse wrote a diagnosis';
  exception when sqlstate 'P0001' then null;
  end;
  insert into medical_records (pet_id, clinic_id, vet_id, appointment_id, visit_type, weight_kg, temperature_c)
    values ('f7500000-0000-0000-0000-0000000000c1', 'f7500000-0000-0000-0000-00000000000a', 'f7500000-0000-0000-0000-000000000003',
            'f7500000-0000-0000-0000-0000000000a1', 'checkup', 12.5, 38.6)
    returning id into v_rec;
  perform set_config('check.rec', v_rec::text, true);
  assert (select vet_id is null and nurse_id = 'f7500000-0000-0000-0000-000000000003' from medical_records where id = v_rec),
    'nurse record must have no doctor yet and the nurse as nurse_id';
  begin
    update medical_records set treatment = 'Drops' where id = v_rec;
    assert false, 'nurse wrote a treatment';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- Doctor One adds the diagnosis; both authors are on the record. The nurse can't finish it now.
do $$
begin
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000001');
  update medical_records set diagnosis = 'Otitis', treatment = 'Drops', nurse_id = null where id = current_setting('check.rec')::uuid;
  assert (select vet_id = 'f7500000-0000-0000-0000-000000000001' and nurse_id = 'f7500000-0000-0000-0000-000000000003'
          from medical_records where id = current_setting('check.rec')::uuid), 'record must keep both authors';
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000003');
  begin
    update appointments set status = 'completed' where id = 'f7500000-0000-0000-0000-0000000000a1';
    assert false, 'nurse finished a visit with a diagnosis';
  exception when sqlstate 'P0001' then null;
  end;
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000001');
  update appointments set status = 'completed' where id = 'f7500000-0000-0000-0000-0000000000a1';
  assert (select started_by from appointments where id = 'f7500000-0000-0000-0000-0000000000a1') = 'f7500000-0000-0000-0000-000000000001',
    'a finished visit keeps its starter';
end $$;

-- After the visit the nurse can't touch the doctor's record, delete records or delete pets.
do $$
begin
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000003');
  begin
    update medical_records set remarks = 'late note' where id = current_setting('check.rec')::uuid;
    assert false, 'nurse edited a finished doctor record';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    delete from medical_records where id = current_setting('check.rec')::uuid;
    assert false, 'nurse deleted a record';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update pets set deleted_at = now() where id = 'f7500000-0000-0000-0000-0000000000c2';
    assert false, 'nurse trashed a pet';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    delete from pets where id = 'f7500000-0000-0000-0000-0000000000c2';
    assert false, 'nurse deleted a pet';
  exception when sqlstate 'P0001' then null;
  end;
  update pets set name = 'Tommy' where id = 'f7500000-0000-0000-0000-0000000000c2'; -- pet details are fine
end $$;

-- A nurse runs a weigh-in alone and finishes it, then can still fix her own record.
do $$
declare
  v_rec uuid;
begin
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000003');
  update appointments set status = 'in_session', started_at = now() where id = 'f7500000-0000-0000-0000-0000000000a2';
  insert into medical_records (pet_id, clinic_id, vet_id, appointment_id, visit_type, weight_kg)
    values ('f7500000-0000-0000-0000-0000000000c1', 'f7500000-0000-0000-0000-00000000000a', 'f7500000-0000-0000-0000-000000000003',
            'f7500000-0000-0000-0000-0000000000a2', 'checkup', 13)
    returning id into v_rec;
  update appointments set status = 'completed' where id = 'f7500000-0000-0000-0000-0000000000a2';
  update medical_records set remarks = 'calm' where id = v_rec;
  assert (select vet_id is null from medical_records where id = v_rec), 'weigh-in has no doctor';
end $$;

-- Stop session and cancel keep working for reception and managers; stop clears the starter.
do $$
begin
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000001');
  update appointments set status = 'in_session', started_at = now() where id = 'f7500000-0000-0000-0000-0000000000a3';
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000004');
  update appointments set status = 'confirmed', started_at = null where id = 'f7500000-0000-0000-0000-0000000000a3';
  assert (select started_by is null from appointments where id = 'f7500000-0000-0000-0000-0000000000a3'), 'stop must clear started_by';
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000001');
  update appointments set status = 'in_session', started_at = now() where id = 'f7500000-0000-0000-0000-0000000000a3';
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000005');
  update appointments set status = 'cancelled', cancellation_category = 'other' where id = 'f7500000-0000-0000-0000-0000000000a3';
end $$;

-- Vaccine doses: reception can't mark or undo; nurses and managers can.
do $$
declare
  v_dose uuid;
begin
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000004');
  begin
    perform public.mark_vaccine_given('f7500000-0000-0000-0000-0000000000e2');
    assert false, 'receptionist marked a dose';
  exception when sqlstate 'P0001' then null;
  end;
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000003');
  perform public.mark_vaccine_given('f7500000-0000-0000-0000-0000000000e2');
  select id into v_dose from vaccine_doses where pet_vaccine_id = 'f7500000-0000-0000-0000-0000000000e2';
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000004');
  begin
    perform public.undo_vaccine_dose(v_dose);
    assert false, 'receptionist undid a dose';
  exception when sqlstate 'P0001' then null;
  end;
  perform pg_temp.act_as('f7500000-0000-0000-0000-000000000005');
  perform public.undo_vaccine_dose(v_dose);
end $$;

reset role;
rollback;
select '0075 session and nurse roles: all checks passed' as result;
