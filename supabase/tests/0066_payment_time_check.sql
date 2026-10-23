-- Checks for migration 0066 (payment time). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0066_payment_time_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f6600000-0000-0000-0000-000000000001', 'pt1@check.local', 'authenticated', 'authenticated'),
  ('f6600000-0000-0000-0000-000000000002', 'pt2@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f6600000-0000-0000-0000-00000000000a', 'Payment time check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6600000-0000-0000-0000-000000000001', 'vet', 'f6600000-0000-0000-0000-00000000000a', 'P Manager', 'manager'),
  ('f6600000-0000-0000-0000-000000000002', 'vet', 'f6600000-0000-0000-0000-00000000000a', 'P Reception', 'receptionist');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f6600000-0000-0000-0000-0000000000a1', 'f6600000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'Owner');
-- Receptionists need a branch (0045 rules); the clinic got a Main branch on insert.
insert into staff_branches (profile_id, branch_id)
  select 'f6600000-0000-0000-0000-000000000002', id from branches where clinic_id = 'f6600000-0000-0000-0000-00000000000a';

set local role authenticated;

-- Receptionist: a sent time is ignored on both paths.
select set_config('request.jwt.claims', json_build_object('sub', 'f6600000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_inv uuid;
  v_at timestamptz;
begin
  v_inv := public.create_invoice('f6600000-0000-0000-0000-0000000000a1', null, null, null,
    '[{"description": "Exam", "unit_price": 200, "quantity": 1}]', null,
    '[{"method": "cash", "amount": 50}]', '2026-01-01 10:00+03');
  select paid_at into v_at from invoice_payments where invoice_id = v_inv;
  assert v_at > now() - interval '1 minute', 'receptionist create_invoice time must be now, got ' || v_at;

  perform public.add_invoice_payment(v_inv, 'card', 50, null, '2026-01-01 10:00+03');
  assert (select count(*) from invoice_payments where invoice_id = v_inv and paid_at < now() - interval '1 minute') = 0,
    'receptionist add_invoice_payment time must be now';
  perform set_config('check.inv', v_inv::text, true);
end $$;

-- Manager: an earlier time is kept, a future one refused, none = now.
select set_config('request.jwt.claims', json_build_object('sub', 'f6600000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_inv uuid := current_setting('check.inv')::uuid;
begin
  perform public.add_invoice_payment(v_inv, 'cash', 10, null, '2026-01-01 10:00+03');
  assert exists (select 1 from invoice_payments where invoice_id = v_inv and paid_at = '2026-01-01 10:00+03'),
    'manager backdated payment must keep its time';

  begin
    perform public.add_invoice_payment(v_inv, 'cash', 10, null, now() + interval '1 day');
    assert false, 'manager future payment time must be refused';
  exception when sqlstate 'P0001' then
    null;
  end;

  perform public.add_invoice_payment(v_inv, 'cash', 10);
  assert (select count(*) from invoice_payments where invoice_id = v_inv and amount = 10 and paid_at > now() - interval '1 minute') = 1,
    'manager payment without a time must be now';
end $$;

reset role;
rollback;
select '0066 payment time: all checks passed' as result;
