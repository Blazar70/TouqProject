-- Checks for migration 0102 (request keys against double saves). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0102_request_keys_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f1020000-0000-0000-0000-000000000001', 'm102@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f1020000-0000-0000-0000-00000000000a', '0102 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f1020000-0000-0000-0000-000000000001', 'vet', 'f1020000-0000-0000-0000-00000000000a', 'M', 'manager');
insert into pets (id, clinic_id, name, species, owner_name, owner_phone) values
  ('f1020000-0000-0000-0000-0000000000c1', 'f1020000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner', '+966501020102');
select set_config('check.branch', (select id::text from branches where clinic_id = 'f1020000-0000-0000-0000-00000000000a' and is_main), true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1020000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_branch uuid := current_setting('check.branch')::uuid;
  v_lines jsonb := '[{"description": "Exam", "unit_price": 100, "quantity": 1}]';
  k1 uuid := gen_random_uuid();
  k2 uuid := gen_random_uuid();
  k3 uuid := gen_random_uuid();
  k4 uuid := gen_random_uuid();
  v_inv uuid;
  v_again uuid;
  v_owner uuid := (select owner_file_id from pets where id = 'f1020000-0000-0000-0000-0000000000c1');
begin
  -- Same key twice: one invoice, the same id back.
  v_inv := public.create_invoice('f1020000-0000-0000-0000-0000000000c1', v_branch, null, null, v_lines, null, '[]', now(), null, k1);
  v_again := public.create_invoice('f1020000-0000-0000-0000-0000000000c1', v_branch, null, null, v_lines, null, '[]', now(), null, k1);
  assert v_inv = v_again, 'a repeated invoice key must return the first invoice';
  assert (select count(*) from invoices where pet_id = 'f1020000-0000-0000-0000-0000000000c1') = 1, 'one invoice only';
  -- No key: still two invoices, as before.
  perform public.create_invoice('f1020000-0000-0000-0000-0000000000c1', v_branch, null, null, v_lines, null, '[]');
  assert (select count(*) from invoices where pet_id = 'f1020000-0000-0000-0000-0000000000c1') = 2, 'calls without a key are unchanged';

  -- Payment twice with one key: paid once.
  perform public.add_invoice_payment(v_inv, 'cash', 40, null, null, k2);
  perform public.add_invoice_payment(v_inv, 'cash', 40, null, null, k2);
  assert (select count(*) from invoice_payments where invoice_id = v_inv) = 1, 'one payment only';

  -- Top-up twice with one key: credited once.
  assert public.add_owner_balance(v_owner, 50, 'cash', null, v_branch, k3) = public.add_owner_balance(v_owner, 50, 'cash', null, v_branch, k3), 'same top-up id back';
  assert (select balance from owner_balances where owner_file_id = v_owner) = 50, 'balance credited once';

  -- Credit note twice with one key: one note.
  assert public.create_credit_note(v_inv, null, 10, 'Check', 'cash', k4) = public.create_credit_note(v_inv, null, 10, 'Check', 'cash', k4), 'same credit note back';
  assert (select count(*) from credit_notes where invoice_id = v_inv) = 1, 'one credit note only';
end $$;

select 'ok: 0102 checks passed' as result;
rollback;
