-- Checks for migration 0059 (services per appointment, one invoice per visit). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0059_visit_services_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f5900000-0000-0000-0000-000000000001', 'vs1@check.local', 'authenticated', 'authenticated'),
  ('f5900000-0000-0000-0000-000000000002', 'vs2@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f5900000-0000-0000-0000-00000000000a', 'Visit check A'),
  ('f5900000-0000-0000-0000-00000000000b', 'Visit check B');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f5900000-0000-0000-0000-000000000001', 'vet', 'f5900000-0000-0000-0000-00000000000a', 'A Reception', 'receptionist'), -- bills the visit below; doctors can't since 0074
  ('f5900000-0000-0000-0000-000000000002', 'vet', 'f5900000-0000-0000-0000-00000000000b', 'B Doctor', 'doctor');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f5900000-0000-0000-0000-0000000000a1', 'f5900000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'O'),
  ('f5900000-0000-0000-0000-0000000000b1', 'f5900000-0000-0000-0000-00000000000b', 'Tom', 'cat', 'O');
insert into appointments (id, clinic_id, pet_id, created_by, scheduled_at, status) values
  ('f5900000-0000-0000-0000-0000000000c1', 'f5900000-0000-0000-0000-00000000000a', 'f5900000-0000-0000-0000-0000000000a1', 'f5900000-0000-0000-0000-000000000001', now(), 'completed'),
  ('f5900000-0000-0000-0000-0000000000c2', 'f5900000-0000-0000-0000-00000000000b', 'f5900000-0000-0000-0000-0000000000b1', 'f5900000-0000-0000-0000-000000000002', now(), 'completed');
insert into services (id, clinic_id, name, price, vat_rate) values
  ('f5900000-0000-0000-0000-0000000000d1', 'f5900000-0000-0000-0000-00000000000a', 'Exam', 130.4348, 15),
  ('f5900000-0000-0000-0000-0000000000d2', 'f5900000-0000-0000-0000-00000000000b', 'B Exam', 100, 15);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f5900000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_row appointment_services;
begin
  -- The client's price, name and clinic are ignored: the DB copies them from the price list.
  insert into appointment_services (appointment_id, service_id, quantity, unit_price, vat_rate, description, clinic_id)
  values ('f5900000-0000-0000-0000-0000000000c1', 'f5900000-0000-0000-0000-0000000000d1', 2, 0.01, 0, 'Free', 'f5900000-0000-0000-0000-00000000000b')
  returning * into v_row;
  assert v_row.unit_price = 130.4348 and v_row.vat_rate = 15 and v_row.description = 'Exam', 'price snapshot not taken from price list';
  assert v_row.clinic_id = 'f5900000-0000-0000-0000-00000000000a', 'clinic not taken from appointment';
  assert v_row.added_by = 'f5900000-0000-0000-0000-000000000001', 'added_by not the caller';

  -- Quantity can change, the price can't.
  update appointment_services set quantity = 3 where id = v_row.id;
  begin
    update appointment_services set unit_price = 1 where id = v_row.id;
    assert false, 'price was changed by the client';
  exception when raise_exception then null;
  end;

  -- Another clinic's service, or another clinic's appointment: refused.
  begin
    insert into appointment_services (appointment_id, service_id) values ('f5900000-0000-0000-0000-0000000000c1', 'f5900000-0000-0000-0000-0000000000d2');
    assert false, 'used another clinic''s service';
  exception when raise_exception then null;
  end;
  begin
    insert into appointment_services (appointment_id, service_id) values ('f5900000-0000-0000-0000-0000000000c2', 'f5900000-0000-0000-0000-0000000000d2');
    assert false, 'added to another clinic''s appointment';
  exception when insufficient_privilege then null; -- RLS check, not the trigger
  end;
end $$;

-- Clinic B sees none of clinic A's rows.
select set_config('request.jwt.claims', json_build_object('sub', 'f5900000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$ begin
  assert not exists (select 1 from appointment_services), 'clinic B sees clinic A''s visit services';
  delete from appointment_services;
  assert not found, 'clinic B deleted clinic A''s visit services';
end $$;

-- Billed: the visit's services are locked, and a second invoice for it is refused.
select set_config('request.jwt.claims', json_build_object('sub', 'f5900000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$ begin
  -- Invoices are created through create_invoice() since 0061.
  perform public.create_invoice('f5900000-0000-0000-0000-0000000000a1', null, 'f5900000-0000-0000-0000-0000000000c1', null,
    '[{"description": "Exam", "unit_price": 450, "quantity": 1}]', null, null);
  begin
    insert into appointment_services (appointment_id, service_id) values ('f5900000-0000-0000-0000-0000000000c1', 'f5900000-0000-0000-0000-0000000000d1');
    assert false, 'insert allowed after billing';
  exception when raise_exception then null;
  end;
  begin
    update appointment_services set quantity = 9;
    assert false, 'update allowed after billing';
  exception when raise_exception then null;
  end;
  begin
    delete from appointment_services;
    assert false, 'delete allowed after billing';
  exception when raise_exception then null;
  end;
  begin
    -- Invoices are created through create_invoice() since 0061.
    perform public.create_invoice('f5900000-0000-0000-0000-0000000000a1', null, 'f5900000-0000-0000-0000-0000000000c1', null,
      '[{"description": "Exam", "unit_price": 1, "quantity": 1}]', null, null);
    assert false, 'second invoice for one appointment';
  exception when unique_violation then null;
  end;
end $$;

-- Deleting a billed appointment (cascade, clinic purge) still works.
reset role;
delete from appointments where id = 'f5900000-0000-0000-0000-0000000000c1';
do $$ begin
  assert not exists (select 1 from appointment_services where appointment_id = 'f5900000-0000-0000-0000-0000000000c1'), 'cascade left rows';
end $$;

select 'all 0059 checks passed' as result;
rollback;
