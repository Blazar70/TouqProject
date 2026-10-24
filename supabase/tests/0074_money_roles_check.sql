-- Checks for migration 0074 (money only for receptionists and managers). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0074_money_roles_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f7400000-0000-0000-0000-000000000001', 'r74@check.local', 'authenticated', 'authenticated'),
  ('f7400000-0000-0000-0000-000000000002', 'm74@check.local', 'authenticated', 'authenticated'),
  ('f7400000-0000-0000-0000-000000000003', 'd74@check.local', 'authenticated', 'authenticated'),
  ('f7400000-0000-0000-0000-000000000004', 'n74@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f7400000-0000-0000-0000-00000000000a', '0074 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f7400000-0000-0000-0000-000000000001', 'vet', 'f7400000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f7400000-0000-0000-0000-000000000002', 'vet', 'f7400000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f7400000-0000-0000-0000-000000000003', 'vet', 'f7400000-0000-0000-0000-00000000000a', 'D', 'doctor'),
  ('f7400000-0000-0000-0000-000000000004', 'vet', 'f7400000-0000-0000-0000-00000000000a', 'N', 'nurse');
delete from staff_branches where profile_id::text like 'f7400000-%';
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f7400000-0000-0000-0000-000000000001', 'f7400000-0000-0000-0000-000000000003', 'f7400000-0000-0000-0000-000000000004']::uuid[]) p
  where b.clinic_id = 'f7400000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f7400000-0000-0000-0000-0000000000c1', 'f7400000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');
insert into services (id, clinic_id, name, price, vat_rate) values
  ('f7400000-0000-0000-0000-0000000000d1', 'f7400000-0000-0000-0000-00000000000a', 'Exam', 100, 15);
insert into appointments (id, pet_id, clinic_id, created_by, doctor_id, scheduled_at, status) values
  ('f7400000-0000-0000-0000-0000000000a1', 'f7400000-0000-0000-0000-0000000000c1', 'f7400000-0000-0000-0000-00000000000a', 'f7400000-0000-0000-0000-000000000002', 'f7400000-0000-0000-0000-000000000003', now() - interval '1 hour', 'in_session'),
  ('f7400000-0000-0000-0000-0000000000a2', 'f7400000-0000-0000-0000-0000000000c1', 'f7400000-0000-0000-0000-00000000000a', 'f7400000-0000-0000-0000-000000000002', 'f7400000-0000-0000-0000-000000000003', now() - interval '2 hours', 'completed');

set local role authenticated;

-- Doctor: prices and visit services still work, finishing a visit works, no billing.
select set_config('request.jwt.claims', json_build_object('sub', 'f7400000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select price from services where id = 'f7400000-0000-0000-0000-0000000000d1') = 100, 'doctor must see list prices';
  insert into appointment_services (appointment_id, service_id) values ('f7400000-0000-0000-0000-0000000000a1', 'f7400000-0000-0000-0000-0000000000d1');
  update appointments set status = 'completed' where id = 'f7400000-0000-0000-0000-0000000000a1';
  assert (select status from appointments where id = 'f7400000-0000-0000-0000-0000000000a1') = 'completed', 'doctor must finish a visit';
  assert not (select billed(a) from appointments a where a.id = 'f7400000-0000-0000-0000-0000000000a1'), 'visit is not billed yet';
  begin
    perform create_invoice('f7400000-0000-0000-0000-0000000000c1', null, null, null,
      '[{"description": "Exam", "unit_price": 115, "quantity": 1}]', null, '[]');
    assert false, 'doctor invoice must be refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'Only receptionists and managers handle money', sqlerrm;
  end;
end $$;

-- Receptionist: bills, takes a deposit, counts cash, sees cash-up and unpaid.
select set_config('request.jwt.claims', json_build_object('sub', 'f7400000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_owner uuid := (select owner_file_id from pets where id = 'f7400000-0000-0000-0000-0000000000c1');
  v_branch uuid := (select id from branches where clinic_id = 'f7400000-0000-0000-0000-00000000000a' and is_main);
  v_inv uuid;
begin
  v_inv := create_invoice('f7400000-0000-0000-0000-0000000000c1', null, 'f7400000-0000-0000-0000-0000000000a1', null,
    '[{"service_id": "f7400000-0000-0000-0000-0000000000d1", "description": "Exam", "unit_price": 115, "quantity": 1}]', null,
    '[{"method": "cash", "amount": 50}]');
  perform set_config('check.inv', v_inv::text, true);
  perform add_owner_balance(v_owner, 20, 'cash');
  insert into cash_counts (clinic_id, branch_id, day, counted) values ('f7400000-0000-0000-0000-00000000000a', v_branch, (now() at time zone 'Asia/Riyadh')::date, 70);
  assert (select count(*) from invoices where id = v_inv) = 1, 'receptionist must see the invoice';
  assert (select count(*) from invoice_items where invoice_id = v_inv) = 1, 'receptionist must see the items';
  assert (select sum(net) from report_cash_up((now() at time zone 'Asia/Riyadh')::date)) = 70, 'cash-up must hold payment + deposit';
  assert (select count(*) from report_unpaid()) = 2, 'unpaid must list the part-paid invoice and the unbilled visit';
  begin
    perform report_income_services(current_date - 1, current_date + 1);
    assert false, 'receptionist income report must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform report_vat_summary(current_date - 1, current_date + 1);
    assert false, 'receptionist VAT report must be refused';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- Doctor: reads no money, the visit shows as billed, its services are locked, no reports.
select set_config('request.jwt.claims', json_build_object('sub', 'f7400000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from invoices) = 0, 'doctor must not read invoices';
  assert (select count(*) from invoice_items) = 0, 'doctor must not read invoice items';
  assert (select count(*) from invoice_payments) = 0, 'doctor must not read payments';
  assert (select count(*) from owner_balance_entries) = 0, 'doctor must not read the balance ledger';
  assert (select count(*) from cash_counts) = 0, 'doctor must not read cash counts';
  assert (select billed(a) from appointments a where a.id = 'f7400000-0000-0000-0000-0000000000a1'), 'doctor must see the visit is billed';
  begin
    insert into appointment_services (appointment_id, service_id) values ('f7400000-0000-0000-0000-0000000000a1', 'f7400000-0000-0000-0000-0000000000d1');
    assert false, 'billed visit services must stay locked';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform report_cash_up(current_date);
    assert false, 'doctor cash-up must be refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'Only receptionists and managers handle money', sqlerrm;
  end;
  begin
    perform report_unpaid();
    assert false, 'doctor unpaid report must be refused';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform add_owner_balance((select owner_file_id from pets where id = 'f7400000-0000-0000-0000-0000000000c1'), 5, 'cash');
    assert false, 'doctor deposit must be refused';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Nurse: can't take a payment.
select set_config('request.jwt.claims', json_build_object('sub', 'f7400000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform add_invoice_payment(current_setting('check.inv')::uuid, 'cash', 10);
    assert false, 'nurse payment must be refused';
  exception when sqlstate 'P0001' then assert sqlerrm = 'Only receptionists and managers handle money', sqlerrm;
  end;
  assert (select count(*) from credit_notes) = 0, 'nurse must not read credit notes';
end $$;

-- Manager: every report.
select set_config('request.jwt.claims', json_build_object('sub', 'f7400000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select sum(total) from report_income_services(current_date - 1, current_date + 1)) = 115, 'manager income per service';
  assert (select sum(invoiced) from report_income_branches(current_date - 1, current_date + 1)) = 115, 'manager income per branch';
  assert (select sum(sales_vat) from report_vat_summary(current_date - 1, current_date + 1)) = 15, 'manager VAT summary';
  assert (select count(*) from report_unpaid()) = 2, 'manager unpaid';
end $$;

reset role;
rollback;
select '0074 money roles: all checks passed' as result;
