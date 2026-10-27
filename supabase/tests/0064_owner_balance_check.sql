-- Checks for migration 0064 (owner balance ledger, top-ups, balance payments,
-- credit-note refunds to balance, merge). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0064_owner_balance_check.sql
-- Updated for 0088 (owner_balances table, branch on balance entries).
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f6400000-0000-0000-0000-000000000001', 'ob1@check.local', 'authenticated', 'authenticated'),
  ('f6400000-0000-0000-0000-000000000002', 'ob2@check.local', 'authenticated', 'authenticated'),
  ('f6400000-0000-0000-0000-000000000003', 'ob3@check.local', 'authenticated', 'authenticated'),
  ('f6400000-0000-0000-0000-000000000004', 'ob4@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f6400000-0000-0000-0000-00000000000a', 'Balance check A'),
  ('f6400000-0000-0000-0000-00000000000b', 'Balance check B');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6400000-0000-0000-0000-000000000001', 'vet', 'f6400000-0000-0000-0000-00000000000a', 'A Manager', 'manager'),
  ('f6400000-0000-0000-0000-000000000002', 'vet', 'f6400000-0000-0000-0000-00000000000a', 'A Reception', 'receptionist'),
  ('f6400000-0000-0000-0000-000000000003', 'vet', 'f6400000-0000-0000-0000-00000000000a', 'A Doctor', 'doctor'),
  ('f6400000-0000-0000-0000-000000000004', 'vet', 'f6400000-0000-0000-0000-00000000000b', 'B Manager', 'manager');
-- Non-managers always work at a branch (0076 checks branch writes).
insert into staff_branches (profile_id, branch_id)
  select p.id, b.id from profiles p join branches b on b.clinic_id = p.clinic_id
  where p.id::text like 'f6400000-%' and p.clinic_role <> 'manager' on conflict do nothing;
insert into owner_files (id, clinic_id, name, phone) values
  ('f6400000-0000-0000-0000-0000000000c1', 'f6400000-0000-0000-0000-00000000000a', 'Noura', '+966501111111'),
  ('f6400000-0000-0000-0000-0000000000c2', 'f6400000-0000-0000-0000-00000000000a', 'Noura 2', null);
insert into pets (id, clinic_id, name, species, owner_name, owner_file_id) values
  ('f6400000-0000-0000-0000-0000000000a1', 'f6400000-0000-0000-0000-00000000000a', 'Rex', 'dog', '', 'f6400000-0000-0000-0000-0000000000c1'),
  ('f6400000-0000-0000-0000-0000000000a2', 'f6400000-0000-0000-0000-00000000000a', 'Mia', 'cat', '', 'f6400000-0000-0000-0000-0000000000c2'),
  ('f6400000-0000-0000-0000-0000000000a3', 'f6400000-0000-0000-0000-00000000000a', 'Tom', 'cat', '', 'f6400000-0000-0000-0000-0000000000c2');

-- 0088: balance entries need a branch; clinic A's main branch.
select set_config('check.branch', (select id::text from branches where clinic_id = 'f6400000-0000-0000-0000-00000000000a' and is_main), true);

set local role authenticated;

-- Doctor: can't top up.
select set_config('request.jwt.claims', json_build_object('sub', 'f6400000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c1', 200, 'cash', null, current_setting('check.branch')::uuid);
    assert false, 'doctor topped up';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Receptionist: top up, pay from balance, refund to balance.
select set_config('request.jwt.claims', json_build_object('sub', 'f6400000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_inv uuid;
  v_n integer;
  v_lines constant jsonb := '[{"description": "Exam", "unit_price": 200, "quantity": 1}]';
begin
  perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c1', 200, 'cash', null, current_setting('check.branch')::uuid);
  assert (select balance from owner_balances where owner_file_id = 'f6400000-0000-0000-0000-0000000000c1') = 200, 'top-up not added';

  -- Bad top-ups: no method check bypass, no negative, no adjustment for a receptionist.
  begin
    perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c1', 50, 'balance', null, current_setting('check.branch')::uuid);
    assert false, 'topped up with method balance';
  exception when raise_exception then null;
  end;
  begin
    perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c1', -50, 'cash', null, current_setting('check.branch')::uuid);
    assert false, 'negative top-up';
  exception when raise_exception then null;
  end;
  begin
    perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c1', 50, null, 'gift', current_setting('check.branch')::uuid);
    assert false, 'receptionist adjusted';
  exception when insufficient_privilege then null;
  end;

  -- 150 from balance + 50 cash pays a 200 invoice; balance 50.
  v_inv := public.create_invoice('f6400000-0000-0000-0000-0000000000a1', null, null, null, v_lines, null,
    '[{"method": "balance", "amount": 150}, {"method": "cash", "amount": 50}]');
  assert (select payment_status from invoices where id = v_inv) = 'paid', 'invoice not paid';
  assert (select balance from owner_balances where owner_file_id = 'f6400000-0000-0000-0000-0000000000c1') = 50, 'balance not taken';
  assert exists (select 1 from owner_balance_entries where invoice_id = v_inv and kind = 'payment' and amount = -150
    and invoice_payment_id is not null and created_by = 'f6400000-0000-0000-0000-000000000002'), 'payment entry missing';

  -- More than the balance: the whole invoice is refused (atomic).
  select count(*) into v_n from invoices where pet_id = 'f6400000-0000-0000-0000-0000000000a1';
  begin
    perform public.create_invoice('f6400000-0000-0000-0000-0000000000a1', null, null, null, v_lines, null, '[{"method": "balance", "amount": 100}]');
    assert false, 'paid 100 from a balance of 50';
  exception when raise_exception then
    assert sqlerrm = 'Not enough balance (available 50.00)', 'unexpected message: ' || sqlerrm;
  end;
  assert (select count(*) from invoices where pet_id = 'f6400000-0000-0000-0000-0000000000a1') = v_n, 'refused invoice was saved';

  -- Same for a later part payment.
  v_inv := public.create_invoice('f6400000-0000-0000-0000-0000000000a1', null, null, null, v_lines, null, null);
  begin
    perform public.add_invoice_payment(v_inv, 'balance', 100);
    assert false, 'part payment over the balance';
  exception when raise_exception then null;
  end;
  assert (select amount_paid from invoices where id = v_inv) = 0, 'refused payment counted';
  perform public.add_invoice_payment(v_inv, 'balance', 50);
  assert (select balance from owner_balances where owner_file_id = 'f6400000-0000-0000-0000-0000000000c1') = 0, 'balance not 0';
  assert (select payment_status from invoices where id = v_inv) = 'partly_paid', 'part payment not counted';

  -- Credit note refunded to the balance: only the part that was paid comes back.
  perform public.create_credit_note(v_inv, null, 200, 'Wrong bill', 'balance');
  assert (select balance from owner_balances where owner_file_id = 'f6400000-0000-0000-0000-0000000000c1') = 50, 'refund to balance wrong';
  assert exists (select 1 from owner_balance_entries where invoice_id = v_inv and kind = 'refund' and amount = 50 and credit_note_id is not null),
    'refund entry missing';

  -- Clients write nothing directly.
  begin
    insert into owner_balance_entries (clinic_id, owner_file_id, kind, amount, method)
    values ('f6400000-0000-0000-0000-00000000000a', 'f6400000-0000-0000-0000-0000000000c1', 'top_up', 1000, 'cash');
    assert false, 'direct ledger insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update owner_balances set balance = 1000 where owner_file_id = 'f6400000-0000-0000-0000-0000000000c1';
    assert false, 'direct balance edit';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Clinic B manager: can't touch clinic A owners.
select set_config('request.jwt.claims', json_build_object('sub', 'f6400000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
do $$ begin
  assert not exists (select 1 from owner_balance_entries where clinic_id = 'f6400000-0000-0000-0000-00000000000a'), 'saw clinic A ledger';
  begin
    perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c1', 10, 'cash', null, current_setting('check.branch')::uuid);
    assert false, 'topped up another clinic''s owner';
  exception when raise_exception then null;
  end;
  begin
    perform public.merge_owner_files('f6400000-0000-0000-0000-0000000000c1', 'f6400000-0000-0000-0000-0000000000c2');
    assert false, 'merged another clinic''s owners';
  exception when raise_exception then null;
  end;
end $$;

-- Manager: adjustments (reason, never below 0), merge.
select set_config('request.jwt.claims', json_build_object('sub', 'f6400000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c1', -60, null, 'Fix', current_setting('check.branch')::uuid);
    assert false, 'balance went below 0';
  exception when raise_exception then null;
  end;
  begin
    perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c1', 10, null, ' ', current_setting('check.branch')::uuid);
    assert false, 'adjustment without reason';
  exception when raise_exception then null;
  end;
  perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c1', -20, null, 'Counted twice', current_setting('check.branch')::uuid);
  perform public.add_owner_balance('f6400000-0000-0000-0000-0000000000c2', 30, 'card', null, current_setting('check.branch')::uuid);
  assert (select balance from owner_balances where owner_file_id = 'f6400000-0000-0000-0000-0000000000c1') = 30, 'adjustment wrong';

  -- Merge c2 into c1: pets, ledger and balance move; c2 is gone; pets take c1's contact.
  perform public.merge_owner_files('f6400000-0000-0000-0000-0000000000c1', 'f6400000-0000-0000-0000-0000000000c2');
  assert not exists (select 1 from owner_files where id = 'f6400000-0000-0000-0000-0000000000c2'), 'merged owner still there';
  assert (select balance from owner_balances where owner_file_id = 'f6400000-0000-0000-0000-0000000000c1') = 60, 'balances not added';
  assert (select count(*) from pets where owner_file_id = 'f6400000-0000-0000-0000-0000000000c1' and owner_name = 'Noura'
    and owner_phone = '+966501111111') = 3, 'pets not moved or not synced';
  assert (select count(*) from owner_balance_entries where owner_file_id = 'f6400000-0000-0000-0000-0000000000c1') = 6, 'ledger not moved';
  begin
    perform public.merge_owner_files('f6400000-0000-0000-0000-0000000000c1', 'f6400000-0000-0000-0000-0000000000c1');
    assert false, 'merged an owner into itself';
  exception when raise_exception then null;
  end;
end $$;

reset role;
do $$ begin
  assert (select count(*) from admin_audit_log where clinic_id = 'f6400000-0000-0000-0000-00000000000a' and action = 'balance_top_up') = 2,
    'top-ups not logged';
  assert exists (select 1 from admin_audit_log where clinic_id = 'f6400000-0000-0000-0000-00000000000a' and action = 'balance_top_up'
    and actor_name = 'A Reception' and target_label = 'Noura · 200.00 · cash'), 'top-up label wrong';
  assert exists (select 1 from admin_audit_log where clinic_id = 'f6400000-0000-0000-0000-00000000000a' and action = 'balance_adjusted'
    and target_label = 'Noura · -20.00 · Counted twice'), 'adjustment not logged';
  assert exists (select 1 from admin_audit_log where clinic_id = 'f6400000-0000-0000-0000-00000000000a' and action = 'owners_merged'
    and target_label = 'Noura 2 → Noura · 30.00'), 'merge not logged';
end $$;

select 'all 0064 checks passed' as result;
rollback;
