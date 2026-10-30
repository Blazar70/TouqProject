-- Checks for migration 0100 (tax phase per clinic). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0100_clinic_tax_phase_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 manager, 2 admin.
insert into auth.users (id, email, aud, role) values
  ('f1000000-0000-0000-0000-000000000001', 'm100@check.local', 'authenticated', 'authenticated'),
  ('f1000000-0000-0000-0000-000000000002', 'a100@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f1000000-0000-0000-0000-00000000000a', '0100 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f1000000-0000-0000-0000-000000000001', 'vet', 'f1000000-0000-0000-0000-00000000000a', 'M', 'manager');
insert into profiles (id, role, full_name) values ('f1000000-0000-0000-0000-000000000002', 'admin', 'A');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f1000000-0000-0000-0000-0000000000c1', 'f1000000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');
insert into services (id, clinic_id, name, price, vat_rate) values
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-00000000000a', 'Exam', 100, 15);
select set_config('check.branch', (select id::text from branches where clinic_id = 'f1000000-0000-0000-0000-00000000000a' and is_main), true);

do $$
begin
  assert (select tax_phase from clinics where id = 'f1000000-0000-0000-0000-00000000000a') = 'none', 'a new clinic starts not registered';
  begin
    update clinics set tax_phase = 'phase1' where id = 'f1000000-0000-0000-0000-00000000000a';
    assert false, 'phase 1 needs a VAT number';
  exception when check_violation then null;
  end;
  begin
    update clinics set tax_phase = 'phase2', vat_number = '300000000000003' where id = 'f1000000-0000-0000-0000-00000000000a';
    assert false, 'phase 2 is not open yet';
  exception when check_violation then null;
  end;
end $$;

set local role authenticated;

-- Manager: can't set the VAT number or the phase any more; the discount limit still works.
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_lines jsonb := '[{"service_id": "f1000000-0000-0000-0000-0000000000a1", "description": "Exam", "unit_price": 115, "quantity": 2}, {"description": "Custom", "unit_price": 23, "quantity": 1}]';
  v_id uuid;
begin
  begin
    update clinics set vat_number = '300000000000003' where id = 'f1000000-0000-0000-0000-00000000000a';
    assert false, 'a manager must not set the VAT number';
  exception when raise_exception then null;
  end;
  update clinics set max_staff_discount_percent = 20 where id = 'f1000000-0000-0000-0000-00000000000a';

  -- Not registered: owner pays the list price (115 x 2 + 23), no VAT anywhere.
  v_id := public.create_invoice('f1000000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid, null, null, v_lines, null, '[]');
  assert (select (amount_total, vat_total, tax_phase) = (253.00::numeric, 0::numeric, 'none') from invoices where id = v_id), 'unregistered invoice: 253, no VAT';
  assert not exists (select 1 from invoice_items where invoice_id = v_id and (vat_rate <> 0 or vat_amount <> 0)), 'unregistered lines carry no VAT';
  perform set_config('check.none_invoice', v_id::text, true);
end $$;

-- Admin moves the clinic to phase 1.
select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
update clinics set tax_phase = 'phase1', vat_number = '300000000000003', zatca_phase2_date = '2027-06-01'
  where id = 'f1000000-0000-0000-0000-00000000000a';

select set_config('request.jwt.claims', json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_lines jsonb := '[{"service_id": "f1000000-0000-0000-0000-0000000000a1", "description": "Exam", "unit_price": 115, "quantity": 2}, {"description": "Custom", "unit_price": 23, "quantity": 1}]';
  v_id uuid;
begin
  -- Same price, now 15% of it is VAT: 30 + 3.
  v_id := public.create_invoice('f1000000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid, null, null, v_lines, null, '[]');
  assert (select (amount_total, vat_total, tax_phase) = (253.00::numeric, 33.00::numeric, 'phase1') from invoices where id = v_id), 'phase-1 invoice: 253 with 33 VAT';
  -- The older invoice keeps its phase.
  assert (select tax_phase from invoices where id = current_setting('check.none_invoice')::uuid) = 'none', 'old invoice stays unregistered';
  -- A credit note on the unregistered invoice carries no VAT.
  perform public.create_credit_note(current_setting('check.none_invoice')::uuid, null, 50, 'check', 'cash');
  assert (select vat_amount from credit_notes where invoice_id = current_setting('check.none_invoice')::uuid) = 0, 'credit note on an unregistered invoice: no VAT';
end $$;

rollback;
