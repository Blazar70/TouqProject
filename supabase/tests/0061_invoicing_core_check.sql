-- Checks for migration 0061 (one-call invoices, discounts, part payments, credit notes,
-- VAT number). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0061_invoicing_core_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f6100000-0000-0000-0000-000000000001', 'ic1@check.local', 'authenticated', 'authenticated'),
  ('f6100000-0000-0000-0000-000000000002', 'ic2@check.local', 'authenticated', 'authenticated'),
  ('f6100000-0000-0000-0000-000000000003', 'ic3@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f6100000-0000-0000-0000-00000000000a', 'Invoice check A'),
  ('f6100000-0000-0000-0000-00000000000b', 'Invoice check B');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6100000-0000-0000-0000-000000000001', 'vet', 'f6100000-0000-0000-0000-00000000000a', 'A Manager', 'manager'),
  ('f6100000-0000-0000-0000-000000000002', 'vet', 'f6100000-0000-0000-0000-00000000000a', 'A Reception', 'receptionist'),
  ('f6100000-0000-0000-0000-000000000003', 'vet', 'f6100000-0000-0000-0000-00000000000b', 'B Manager', 'manager');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f6100000-0000-0000-0000-0000000000a1', 'f6100000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'O');
insert into services (id, clinic_id, name, price, vat_rate) values
  ('f6100000-0000-0000-0000-0000000000d1', 'f6100000-0000-0000-0000-00000000000a', 'Exam', 130.4348, 15),
  ('f6100000-0000-0000-0000-0000000000d2', 'f6100000-0000-0000-0000-00000000000a', 'Food', 16.67, 0); -- 0062: price-list lines use this price

set local role authenticated;

-- Receptionist: up to the clinic's limit (default 10%), a reason every time.
select set_config('request.jwt.claims', json_build_object('sub', 'f6100000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_id uuid;
  v_inv invoices;
  v_line invoice_items;
begin
  -- 10% line discount: VAT comes out of the discounted 135.00, not the 150.00.
  v_id := public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, ' ',
    '[{"service_id": "f6100000-0000-0000-0000-0000000000d1", "description": "Exam", "unit_price": 150, "quantity": 1,
       "discount": {"type": "percent", "value": 10, "reason": "Loyal client"}}]',
    null, '[{"method": "cash", "amount": 35}, {"method": "card", "amount": 100}]');
  select * into v_inv from invoices where id = v_id;
  select * into v_line from invoice_items where invoice_id = v_id;
  assert v_line.discount_amount = 15 and v_line.line_total = 135, 'line discount wrong';
  assert v_inv.amount_total = 135 and v_inv.vat_total = 17.61, 'VAT not on the discounted amount: ' || v_inv.vat_total;
  assert v_inv.amount_paid = 135 and v_inv.payment_status = 'paid', 'two parts did not pay it';
  assert v_inv.notes is null and v_inv.created_by = 'f6100000-0000-0000-0000-000000000002', 'notes/created_by wrong';
  assert (select count(*) from invoice_payments where invoice_id = v_id) = 2, 'payments not saved';

  -- Over the limit: refused, as percent and as a fixed amount (11 of 100 = 11%).
  begin
    perform public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, null,
      '[{"description": "X", "unit_price": 100, "quantity": 1, "discount": {"type": "percent", "value": 30, "reason": "r"}}]', null, null);
    assert false, 'receptionist gave 30%';
  exception when raise_exception then
    assert sqlerrm like 'Discount over the staff limit of 10%', 'unexpected message: ' || sqlerrm;
  end;
  begin
    perform public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, null,
      '[{"description": "X", "unit_price": 100, "quantity": 1}]', '{"type": "amount", "value": 11, "reason": "r"}', null);
    assert false, 'receptionist gave a fixed 11%';
  exception when raise_exception then null;
  end;
  -- No reason: refused.
  begin
    perform public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, null,
      '[{"description": "X", "unit_price": 100, "quantity": 1, "discount": {"type": "percent", "value": 5, "reason": " "}}]', null, null);
    assert false, 'discount without reason';
  exception when raise_exception then null;
  end;
  -- Paying more than the total: refused.
  begin
    perform public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, null,
      '[{"description": "X", "unit_price": 100, "quantity": 1}]', null, '[{"method": "cash", "amount": 100.01}]');
    assert false, 'overpayment accepted';
  exception when raise_exception then null;
  end;

  -- Receptionist can't change billing settings, can still rename (0054).
  begin
    update clinics set max_staff_discount_percent = 50 where id = 'f6100000-0000-0000-0000-00000000000a';
    assert false, 'receptionist raised the discount limit';
  exception when raise_exception then null;
  end;
  begin
    update clinics set vat_number = '300000000000003' where id = 'f6100000-0000-0000-0000-00000000000a';
    assert false, 'receptionist set the VAT number';
  exception when raise_exception then null;
  end;
  update clinics set name = 'Invoice check A2' where id = 'f6100000-0000-0000-0000-00000000000a';

  -- Clients write nothing directly.
  begin
    insert into invoice_payments (invoice_id, clinic_id, branch_id, method, amount)
    select id, clinic_id, branch_id, 'cash', 1 from invoices where id = v_id;
    assert false, 'direct payment insert';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.refresh_invoice_status(v_id);
    assert false, 'client called refresh_invoice_status';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Manager: any discount; sets VAT number and limit.
select set_config('request.jwt.claims', json_build_object('sub', 'f6100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_id uuid;
  v_inv invoices;
  v_cn credit_notes;
  v_items uuid[];
begin
  v_id := public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, null,
    '[{"description": "X", "unit_price": 100, "quantity": 1, "discount": {"type": "percent", "value": 30, "reason": "Staff pet"}}]', null, null);
  assert (select amount_total from invoices where id = v_id) = 70, 'manager 30% not applied';

  -- Whole-bill discount spread over lines; each line's VAT at its own rate (Food is 0%).
  v_id := public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, null,
    '[{"description": "A", "unit_price": 100, "quantity": 1},
      {"service_id": "f6100000-0000-0000-0000-0000000000d2", "description": "Food", "unit_price": 16.67, "quantity": 3}]',
    '{"type": "amount", "value": 10, "reason": "Rounding off"}', '[{"method": "apple_pay", "amount": 50}]');
  select * into v_inv from invoices where id = v_id;
  -- 100 + 50.01 = 150.01; shares 6.67 / 3.33; VAT round(93.33 * 15 / 115) = 12.17, Food 0.
  assert v_inv.amount_total = 140.01 and v_inv.discount_amount = 10, 'bill discount total wrong';
  assert (select array_agg(bill_discount_share order by position) from invoice_items where invoice_id = v_id) = array[6.67, 3.33]::numeric[], 'shares wrong';
  assert v_inv.vat_total = 12.17, 'mixed-rate VAT wrong: ' || v_inv.vat_total;
  assert v_inv.payment_status = 'partly_paid' and v_inv.amount_paid = 50, 'not partly paid';

  -- Add the rest -> paid; more -> refused.
  begin
    perform public.add_invoice_payment(v_id, 'card', 90.02);
    assert false, 'overpayment accepted';
  exception when raise_exception then null;
  end;
  perform public.add_invoice_payment(v_id, 'card', 90.01);
  assert (select payment_status from invoices where id = v_id) = 'paid', 'not paid after second part';

  -- Credit the Food line: amount after its bill share, own number, refund of paid money.
  select array_agg(id order by position) into v_items from invoice_items where invoice_id = v_id;
  begin
    perform public.create_credit_note(v_id, array[v_items[2]], null, '', 'cash');
    assert false, 'credit note without reason';
  exception when raise_exception then null;
  end;
  v_cn.id := public.create_credit_note(v_id, array[v_items[2]], null, 'Returned food', 'cash');
  select * into v_cn from credit_notes where id = v_cn.id;
  assert v_cn.amount = 46.68 and v_cn.vat_amount = 0 and v_cn.refund_amount = 46.68, 'line credit wrong';
  assert v_cn.credit_number = 'CN-MAIN-000001', 'credit number wrong: ' || v_cn.credit_number;
  begin
    perform public.create_credit_note(v_id, array[v_items[2]], null, 'again', 'cash');
    assert false, 'line credited twice';
  exception when raise_exception then null;
  end;
  begin
    perform public.create_credit_note(v_id, null, 93.34, 'too much', 'card');
    assert false, 'credit over what is left';
  exception when raise_exception then null;
  end;
  v_cn.id := public.create_credit_note(v_id, null, 93.33, 'Rest', 'card');
  select * into v_cn from credit_notes where id = v_cn.id;
  assert v_cn.credit_number = 'CN-MAIN-000002' and v_cn.vat_amount = 12.17, 'second credit wrong: ' || v_cn.vat_amount;
  select * into v_inv from invoices where id = v_id;
  assert v_inv.amount_credited = 140.01 and v_inv.amount_refunded = 140.01 and v_inv.payment_status = 'paid', 'credited totals wrong';

  -- Credit on an unpaid invoice reduces what is owed, refunds nothing.
  v_id := public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, null,
    '[{"description": "Y", "unit_price": 200, "quantity": 1}]', null, '[{"method": "cash", "amount": 50}]');
  v_cn.id := public.create_credit_note(v_id, null, 100, 'Price error', 'cash');
  select * into v_cn from credit_notes where id = v_cn.id;
  select * into v_inv from invoices where id = v_id;
  assert v_cn.refund_amount = 0 and v_inv.payment_status = 'partly_paid', 'credit on owed amount wrong';
  perform public.add_invoice_payment(v_id, 'cash', 50);
  assert (select payment_status from invoices where id = v_id) = 'paid', 'remaining after credit wrong';

  -- Manager sets the billing settings; bad VAT numbers refused.
  update clinics set vat_number = '310123456700003', max_staff_discount_percent = 20 where id = 'f6100000-0000-0000-0000-00000000000a';
  begin
    update clinics set vat_number = '123' where id = 'f6100000-0000-0000-0000-00000000000a';
    assert false, 'bad VAT number accepted';
  exception when check_violation then null;
  end;
end $$;

-- The receptionist's limit follows the setting (now 20%).
select set_config('request.jwt.claims', json_build_object('sub', 'f6100000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$ begin
  perform public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, null,
    '[{"description": "X", "unit_price": 100, "quantity": 1, "discount": {"type": "percent", "value": 20, "reason": "r"}}]', null, null);
end $$;

-- Another clinic sees and touches nothing.
select set_config('request.jwt.claims', json_build_object('sub', 'f6100000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$ begin
  assert not exists (select 1 from invoices where clinic_id = 'f6100000-0000-0000-0000-00000000000a'), 'clinic B sees A''s invoices';
  assert not exists (select 1 from invoice_payments where clinic_id = 'f6100000-0000-0000-0000-00000000000a'), 'clinic B sees A''s payments';
  assert not exists (select 1 from credit_notes where clinic_id = 'f6100000-0000-0000-0000-00000000000a'), 'clinic B sees A''s credit notes';
  begin
    perform public.add_invoice_payment((select id from invoices where clinic_id = 'f6100000-0000-0000-0000-00000000000a' limit 1), 'cash', 1);
    assert false, 'clinic B paid A''s invoice';
  exception when raise_exception then null;
  end;
  begin
    perform public.create_invoice('f6100000-0000-0000-0000-0000000000a1', null, null, null, '[{"description": "X", "unit_price": 1, "quantity": 1}]', null, null);
    assert false, 'clinic B billed A''s pet';
  exception when raise_exception then null;
  end;
end $$;

-- Every discount and credit note is in the audit log, with number and reason.
reset role;
do $$ begin
  assert (select count(*) from admin_audit_log where clinic_id = 'f6100000-0000-0000-0000-00000000000a' and action = 'discount_given') = 4,
    'discounts not all logged';
  assert exists (select 1 from admin_audit_log where clinic_id = 'f6100000-0000-0000-0000-00000000000a' and action = 'discount_given'
    and target_label like '%-000001 · Exam · 10% = 15.00 · Loyal client' and actor_name = 'A Reception'), 'line discount label wrong';
  assert (select count(*) from admin_audit_log where clinic_id = 'f6100000-0000-0000-0000-00000000000a' and action = 'credit_note_issued') = 3,
    'credit notes not logged';
end $$;

select 'all 0061 checks passed' as result;
rollback;
