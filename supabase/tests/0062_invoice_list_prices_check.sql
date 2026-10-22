-- Checks for migration 0062 (price-list lines use the list price). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0062_invoice_list_prices_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f6200000-0000-0000-0000-000000000001', 'lp1@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f6200000-0000-0000-0000-00000000000a', 'List price X');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6200000-0000-0000-0000-000000000001', 'vet', 'f6200000-0000-0000-0000-00000000000a', 'X Reception', 'receptionist');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f6200000-0000-0000-0000-0000000000a1', 'f6200000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'O');
-- 130.4348 pre-VAT at 15% = 150.00 with VAT.
insert into services (id, clinic_id, name, price, vat_rate) values
  ('f6200000-0000-0000-0000-0000000000d1', 'f6200000-0000-0000-0000-00000000000a', 'Exam', 130.4348, 15);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f6200000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_id uuid;
begin
  -- The receptionist sends 1.00 for the price-list line and 40.00 for a typed line.
  v_id := public.create_invoice(
    'f6200000-0000-0000-0000-0000000000a1',
    (select id from branches where clinic_id = 'f6200000-0000-0000-0000-00000000000a' limit 1),
    null, null,
    jsonb_build_array(
      jsonb_build_object('service_id', 'f6200000-0000-0000-0000-0000000000d1', 'description', 'Exam', 'unit_price', 1, 'quantity', 2),
      jsonb_build_object('description', 'Custom item', 'unit_price', 40, 'quantity', 1)
    ),
    null, '[]'::jsonb);

  assert (select unit_price from invoice_items where invoice_id = v_id and position = 1) = 150,
    'price-list line did not use the list price';
  assert (select unit_price from invoice_items where invoice_id = v_id and position = 2) = 40,
    'typed line lost its typed price';
  assert (select amount_total from invoices where id = v_id) = 340, 'total is not 2 x 150 + 40';
end $$;

reset role;
select 'all 0062 checks passed' as result;
rollback;
