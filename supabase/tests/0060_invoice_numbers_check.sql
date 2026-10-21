-- Checks for migration 0060 (invoice numbers per branch). RUN ON STAGING ONLY, after 0061:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0060_invoice_numbers_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f6000000-0000-0000-0000-000000000001', 'in1@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f6000000-0000-0000-0000-00000000000a', 'Number check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6000000-0000-0000-0000-000000000001', 'vet', 'f6000000-0000-0000-0000-00000000000a', 'N Manager', 'manager');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f6000000-0000-0000-0000-0000000000a1', 'f6000000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'O');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f6000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_main uuid;
  v_east uuid;
  v_ar uuid;
  v_dup uuid;
  v_numbers text[];
  v_id uuid;
  l jsonb := '[{"description": "Exam", "unit_price": 100, "quantity": 1}]';
begin
  -- Default codes: Latin letters of the name, BR1 for an Arabic-only name, a digit when taken.
  select id into v_main from branches where clinic_id = 'f6000000-0000-0000-0000-00000000000a' and is_main;
  assert (select invoice_code from branches where id = v_main) = 'MAIN', 'main branch code not MAIN';
  insert into branches (clinic_id, name) values ('f6000000-0000-0000-0000-00000000000a', 'East Riyadh') returning id into v_east;
  assert (select invoice_code from branches where id = v_east) = 'EASTRI', 'default code not from the name';
  insert into branches (clinic_id, name) values ('f6000000-0000-0000-0000-00000000000a', 'الشمال') returning id into v_ar;
  assert (select invoice_code from branches where id = v_ar) = 'BR1', 'Arabic-only name did not get BR1';
  insert into branches (clinic_id, name) values ('f6000000-0000-0000-0000-00000000000a', 'Main 2') returning id into v_dup;
  assert (select invoice_code from branches where id = v_dup) = 'MAIN2', 'taken code not suffixed';

  -- Managers set a code; bad formats and duplicates are refused.
  update branches set invoice_code = 'EAST' where id = v_east;
  begin
    update branches set invoice_code = 'east-1' where id = v_east;
    assert false, 'bad code format accepted';
  exception when check_violation then null;
  end;
  begin
    update branches set invoice_code = 'MAIN' where id = v_east;
    assert false, 'duplicate code accepted';
  exception when unique_violation then null;
  end;

  -- Numbers are sequential per branch, assigned by the DB.
  perform public.create_invoice('f6000000-0000-0000-0000-0000000000a1', v_east, null, null, l, null, null);
  perform public.create_invoice('f6000000-0000-0000-0000-0000000000a1', v_east, null, null, l, null, null);
  perform public.create_invoice('f6000000-0000-0000-0000-0000000000a1', v_main, null, null, l, null, null);
  select array_agg(invoice_number order by invoice_number) into v_numbers from invoices where clinic_id = 'f6000000-0000-0000-0000-00000000000a';
  assert v_numbers = array['EAST-000001', 'EAST-000002', 'MAIN-000001'], 'numbers not sequential per branch: ' || v_numbers::text;

  -- A failed create (bad line) doesn't burn or reuse a number.
  begin
    perform public.create_invoice('f6000000-0000-0000-0000-0000000000a1', v_east, null, null, '[{"description": "", "unit_price": 1, "quantity": 1}]', null, null);
    assert false, 'invalid line accepted';
  exception when raise_exception then null;
  end;
  v_id := public.create_invoice('f6000000-0000-0000-0000-0000000000a1', v_east, null, null, l, null, null);
  assert (select invoice_number from invoices where id = v_id) = 'EAST-000003', 'next number wrong';

  -- Locked once the branch has invoices; a branch without any can still change.
  begin
    update branches set invoice_code = 'EST' where id = v_east;
    assert false, 'code changed after invoices';
  exception when raise_exception then null;
  end;
  update branches set name = 'East Side' where id = v_east; -- other fields still editable
  update branches set invoice_code = 'NRT' where id = v_ar;

  -- Clients can't write numbers or delete invoices.
  begin
    update invoices set invoice_number = 'X-1' where id = v_id;
    assert false, 'client changed an invoice number';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from invoices where id = v_id;
    assert false, 'client deleted an invoice';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into invoices (clinic_id, pet_id, created_by, amount_total) values
      ('f6000000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-0000000000a1', 'f6000000-0000-0000-0000-000000000001', 1);
    assert false, 'client inserted an invoice directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update invoices set amount_total = 1 where id = v_id;
    assert false, 'client changed a total';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Numbers are never reused: a purged invoice's number stays taken (counter only grows).
reset role;
delete from invoices where invoice_number = 'EAST-000003' and clinic_id = 'f6000000-0000-0000-0000-00000000000a';
set local role authenticated;
do $$
declare
  v_id uuid;
begin
  v_id := public.create_invoice('f6000000-0000-0000-0000-0000000000a1',
    (select id from branches where clinic_id = 'f6000000-0000-0000-0000-00000000000a' and invoice_code = 'EAST'),
    null, null, '[{"description": "Exam", "unit_price": 100, "quantity": 1}]', null, null);
  assert (select invoice_number from invoices where id = v_id) = 'EAST-000004', 'number reused';
end $$;

select 'all 0060 checks passed' as result;
rollback;
