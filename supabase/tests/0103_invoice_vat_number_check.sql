-- Checks for migration 0103 (VAT number kept on each invoice). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0103_invoice_vat_number_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f1030000-0000-0000-0000-000000000001', 'm103@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name, vat_number, tax_phase) values ('f1030000-0000-0000-0000-00000000000a', '0103 check', '300000000000003', 'phase1');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f1030000-0000-0000-0000-000000000001', 'vet', 'f1030000-0000-0000-0000-00000000000a', 'M', 'manager');
insert into pets (id, clinic_id, name, species, owner_name, owner_phone) values
  ('f1030000-0000-0000-0000-0000000000c1', 'f1030000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner', '+966501030103');
select set_config('check.branch', (select id::text from branches where clinic_id = 'f1030000-0000-0000-0000-00000000000a' and is_main), true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1030000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select set_config('check.first', public.create_invoice('f1030000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid,
  null, null, '[{"description": "Exam", "unit_price": 115, "quantity": 1}]', null, '[]')::text, true);
do $$ begin
  assert (select vat_number from invoices where id = current_setting('check.first')::uuid) = '300000000000003', 'a phase-1 invoice keeps the clinic VAT number';
end $$;

-- As the admin would: correct the number, then clear it (back to "not registered").
reset role;
select set_config('request.jwt.claims', '', true);
update clinics set vat_number = '311111111111113' where id = 'f1030000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select vat_number from invoices where id = current_setting('check.first')::uuid) = '300000000000003', 'correcting the clinic number leaves the old invoice alone';
end $$;
update clinics set tax_phase = 'none', vat_number = null where id = 'f1030000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select vat_number from invoices where id = current_setting('check.first')::uuid) = '300000000000003', 'clearing the clinic number leaves the old invoice alone';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1030000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_plain uuid := public.create_invoice('f1030000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid,
    null, null, '[{"description": "Exam", "unit_price": 115, "quantity": 1}]', null, '[]');
begin
  assert (select vat_number is null and tax_phase = 'none' and vat_total = 0 from invoices where id = v_plain), 'an unregistered clinic''s invoice has no VAT number';
  begin
    update invoices set vat_number = '322222222222223' where id = current_setting('check.first')::uuid;
    assert false, 'staff must not be able to change an invoice VAT number';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
