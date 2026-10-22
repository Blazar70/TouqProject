-- Checks for migration 0065 (reports: cash-up, unpaid, income, VAT). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0065_reports_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
-- Day D = 2026-10-20 in Riyadh (UTC+3). Everything is dated D 10:00 local unless said.

begin;

insert into auth.users (id, email, aud, role) values
  ('f6500000-0000-0000-0000-000000000001', 'rp1@check.local', 'authenticated', 'authenticated'),
  ('f6500000-0000-0000-0000-000000000002', 'rp2@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f6500000-0000-0000-0000-00000000000a', 'Report check A'),
  ('f6500000-0000-0000-0000-00000000000b', 'Report check B');
insert into branches (id, clinic_id, name, invoice_code) values
  ('f6500000-0000-0000-0000-0000000000e1', 'f6500000-0000-0000-0000-00000000000a', 'East', 'EAST');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6500000-0000-0000-0000-000000000001', 'vet', 'f6500000-0000-0000-0000-00000000000a', 'A Manager', 'manager'),
  ('f6500000-0000-0000-0000-000000000002', 'vet', 'f6500000-0000-0000-0000-00000000000b', 'B Manager', 'manager');
insert into owner_files (id, clinic_id, name, phone) values
  ('f6500000-0000-0000-0000-0000000000c1', 'f6500000-0000-0000-0000-00000000000a', 'Noura', '+966501111111');
insert into pets (id, clinic_id, name, species, owner_name, owner_file_id) values
  ('f6500000-0000-0000-0000-0000000000a1', 'f6500000-0000-0000-0000-00000000000a', 'Rex', 'dog', '', 'f6500000-0000-0000-0000-0000000000c1'),
  ('f6500000-0000-0000-0000-0000000000b1', 'f6500000-0000-0000-0000-00000000000b', 'Other', 'cat', 'B owner', null);
insert into services (id, clinic_id, name, price, vat_rate) values
  ('f6500000-0000-0000-0000-0000000000d1', 'f6500000-0000-0000-0000-00000000000a', 'Exam', 100, 15),    -- 115.00
  ('f6500000-0000-0000-0000-0000000000d2', 'f6500000-0000-0000-0000-00000000000a', 'Vaccine', 50, 0);   -- zero-rated
insert into appointments (id, clinic_id, pet_id, scheduled_at, status, created_by, doctor_id) values
  ('f6500000-0000-0000-0000-0000000000f1', 'f6500000-0000-0000-0000-00000000000a', 'f6500000-0000-0000-0000-0000000000a1',
   '2026-10-20 09:00+03', 'completed', 'f6500000-0000-0000-0000-000000000001', 'f6500000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f6500000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_inv uuid;
  v_item uuid;
  v_east constant uuid := 'f6500000-0000-0000-0000-0000000000e1';
  v_pet constant uuid := 'f6500000-0000-0000-0000-0000000000a1';
begin
  -- Unbilled completed visit with one Exam.
  insert into appointment_services (appointment_id, service_id, quantity)
  values ('f6500000-0000-0000-0000-0000000000f1', 'f6500000-0000-0000-0000-0000000000d1', 1);

  -- inv1 (main): Exam x2 -10%, Vaccine (0%), custom Shampoo 30; bill -10%. Total 258.30, VAT 27.82. Paid 100 cash + 58.30 card.
  v_inv := public.create_invoice(v_pet, null, null, null,
    '[{"service_id": "f6500000-0000-0000-0000-0000000000d1", "description": "Exam", "unit_price": 115, "quantity": 2,
       "discount": {"type": "percent", "value": 10, "reason": "Loyal"}},
      {"service_id": "f6500000-0000-0000-0000-0000000000d2", "description": "Vaccine", "unit_price": 50, "quantity": 1},
      {"description": "Shampoo", "unit_price": 30, "quantity": 1}]',
    '{"type": "percent", "value": 10, "reason": "Promo"}',
    '[{"method": "cash", "amount": 100}, {"method": "card", "amount": 58.30}]');
  assert (select (amount_total, vat_total, discount_amount) = (258.30, 27.82, 28.70) from invoices where id = v_inv), 'inv1 totals';
  perform set_config('chk.inv1', v_inv::text, true);

  -- inv2 (East): Exam 115 paid by Apple Pay, then fully credited, refunded by card.
  v_inv := public.create_invoice(v_pet, v_east, null, null,
    '[{"service_id": "f6500000-0000-0000-0000-0000000000d1", "description": "Exam", "unit_price": 115, "quantity": 1}]',
    null, '[{"method": "apple_pay", "amount": 115}]');
  select id into v_item from invoice_items where invoice_id = v_inv;
  perform public.create_credit_note(v_inv, array[v_item], null, 'Not done', 'card');
  perform set_config('chk.inv2', v_inv::text, true);

  -- Deposit 200 cash at main; inv3 (main) custom 60 paid from balance; credit 20 back to balance.
  perform public.add_owner_balance('f6500000-0000-0000-0000-0000000000c1', 200, 'cash', null,
    (select id from branches where clinic_id = 'f6500000-0000-0000-0000-00000000000a' and is_main));
  v_inv := public.create_invoice(v_pet, null, null, null, '[{"description": "Shampoo", "unit_price": 60, "quantity": 1}]',
    null, '[{"method": "balance", "amount": 60}]');
  perform public.create_credit_note(v_inv, null, 20, 'Smaller bottle', 'balance');
  assert (select (amount, vat_amount, refund_amount) = (20.00, 2.61, 20.00) from credit_notes where invoice_id = v_inv), 'cn3';
  perform set_config('chk.inv3', v_inv::text, true);

  -- inv4 (main): Exam 115, two cash parts paid either side of midnight (dated below).
  v_inv := public.create_invoice(v_pet, null, null, null,
    '[{"service_id": "f6500000-0000-0000-0000-0000000000d1", "description": "Exam", "unit_price": 115, "quantity": 1}]', null, null);
  perform public.add_invoice_payment(v_inv, 'cash', 10);
  perform public.add_invoice_payment(v_inv, 'cash', 20);
  perform set_config('chk.inv4', v_inv::text, true);
end $$;

-- Clinic B: one invoice paid 999 cash on D.
select set_config('request.jwt.claims', json_build_object('sub', 'f6500000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select public.create_invoice('f6500000-0000-0000-0000-0000000000b1', null, null, null,
  '[{"description": "Visit", "unit_price": 999, "quantity": 1}]', null, '[{"method": "cash", "amount": 999}]');

-- Dates (as the table owner).
reset role;
update invoices set created_at = '2026-10-20 10:00+03' where clinic_id in ('f6500000-0000-0000-0000-00000000000a', 'f6500000-0000-0000-0000-00000000000b');
update invoices set created_at = '2026-10-20 11:00+03' where id = current_setting('chk.inv4')::uuid;
update invoice_payments set paid_at = '2026-10-20 10:00+03' where clinic_id in ('f6500000-0000-0000-0000-00000000000a', 'f6500000-0000-0000-0000-00000000000b');
update invoice_payments set paid_at = '2026-10-19 23:59:30+03' where invoice_id = current_setting('chk.inv4')::uuid and amount = 10;
update invoice_payments set paid_at = '2026-10-20 00:00:30+03' where invoice_id = current_setting('chk.inv4')::uuid and amount = 20; -- still 2026-10-19 in UTC
update credit_notes set created_at = '2026-10-20 10:00+03' where clinic_id = 'f6500000-0000-0000-0000-00000000000a';
update owner_balance_entries set created_at = '2026-10-20 10:00+03' where clinic_id = 'f6500000-0000-0000-0000-00000000000a';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f6500000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_main constant uuid := (select id from branches where clinic_id = 'f6500000-0000-0000-0000-00000000000a' and is_main);
  v_east constant uuid := 'f6500000-0000-0000-0000-0000000000e1';
  v_got text;
begin
  -- Cash-up, D, all branches: (branch, method, payments, deposits, refunds, net, entries).
  select string_agg(format('%s|%s|%s|%s|%s|%s|%s', case when branch_id = v_main then 'main' when branch_id = v_east then 'east' else branch_id::text end,
                           method, payments, deposits, refunds, net, entries), ' ; ' order by branch_id = v_east, method)
    into v_got from public.report_cash_up('2026-10-20');
  assert v_got = 'main|balance|60.00|0|20.00|40.00|1 ; main|card|58.30|0|0|58.30|1 ; main|cash|120.00|200.00|0|320.00|3'
    || ' ; east|apple_pay|115.00|0|0|115.00|1 ; east|card|0|0|115.00|-115.00|0', 'cash-up D: ' || v_got;
  -- The 23:59:30 payment belongs to the day before; nothing else does.
  select string_agg(format('%s|%s|%s', method, payments, entries), ' ; ') into v_got from public.report_cash_up('2026-10-19');
  assert v_got = 'cash|10.00|1', 'cash-up D-1: ' || v_got;
  assert (select count(*) from public.report_cash_up('2026-10-20', v_east)) = 2, 'cash-up branch filter';

  -- Unpaid: the visit (115.00 of services), inv1 (100 left), inv4 (85 left); oldest first.
  select string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s', kind, coalesce(doctor_name, '-'), owner_name, owner_phone, total, paid, remaining,
                           coalesce(invoice_number, '-') <> '-'), ' ; ' order by at)
    into v_got from public.report_unpaid();
  assert v_got = 'visit|A Manager|Noura|+966501111111|115.00|0|115.00|f ; invoice|-|Noura|+966501111111|258.30|158.30|100.00|t'
    || ' ; invoice|-|Noura|+966501111111|115.00|30.00|85.00|t', 'unpaid: ' || v_got;
  assert (select count(*) from public.report_unpaid(v_east)) = 0, 'unpaid branch filter';
  assert (select count(*) from public.report_unpaid(null, '2026-10-21', null)) = 0, 'unpaid date filter';

  -- Income per service, D: (name, qty, net, vat, total, credited). Custom lines = null name.
  select string_agg(format('%s|%s|%s|%s|%s|%s', coalesce(service_name, 'Other'), quantity, net, vat, total, credited), ' ; ')
    into v_got from public.report_income_services('2026-10-20', '2026-10-20');
  assert v_got = 'Exam|4|262.00|39.30|301.30|115.00 ; Other|2|58.26|8.74|67.00|20.00 ; Vaccine|1|45.00|0.00|45.00|0', 'income services: ' || v_got;

  -- Income per branch: (invoiced, credited, net, collected).
  select string_agg(format('%s|%s|%s|%s|%s', case when branch_id = v_main then 'main' else 'east' end, invoiced, credited, net, collected),
                    ' ; ' order by branch_id = v_east)
    into v_got from public.report_income_branches('2026-10-20', '2026-10-20');
  assert v_got = 'main|433.30|20.00|413.30|218.30 ; east|115.00|115.00|0.00|0.00', 'income branches: ' || v_got;

  -- VAT summary: (rate, sales net, VAT, discounts, credit net, credit VAT, net taxable, net VAT).
  select string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s', vat_rate, sales_net, sales_vat, discounts, credit_net, credit_vat, net_taxable, net_vat), ' ; ')
    into v_got from public.report_vat_summary('2026-10-20', '2026-10-20');
  assert v_got = '15.00|437.65|65.65|46.70|-117.39|-17.61|320.26|48.04 ; 0.00|45.00|0.00|5.00|0|0|45.00|0.00', 'vat: ' || v_got;
  assert not exists (select 1 from public.report_vat_summary('2026-10-21', '2026-10-31')), 'vat outside the dates';
end $$;

-- Clinic B sees only its own 999; clinic A's numbers never show.
select set_config('request.jwt.claims', json_build_object('sub', 'f6500000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_got text;
begin
  select string_agg(format('%s|%s|%s', method, payments, entries), ' ; ') into v_got from public.report_cash_up('2026-10-20');
  assert v_got = 'cash|999.00|1', 'B cash-up: ' || v_got;
  assert (select count(*) from public.report_unpaid()) = 0, 'B unpaid';
  assert (select string_agg(invoiced::text, ',') from public.report_income_branches('2026-10-20', '2026-10-20')) = '999.00', 'B income';
  assert (select count(*) from public.report_income_services('2026-10-20', '2026-10-20')) = 1, 'B services';
  assert (select string_agg(sales_net::text, ',') from public.report_vat_summary('2026-10-20', '2026-10-20')) = '868.70', 'B vat';
  -- Asking for clinic A's branch gives nothing.
  assert (select count(*) from public.report_cash_up('2026-10-20', 'f6500000-0000-0000-0000-0000000000e1')) = 0, 'B saw A branch';
end $$;

-- Not signed in: nothing.
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
do $$ begin
  assert (select count(*) from public.report_cash_up('2026-10-20')) = 0, 'anon saw cash-up';
end $$;

select 'all 0065 checks passed' as result;
rollback;
