-- Checks for migration 0070 (deposit receipts, invoice-code log, ZATCA columns). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0070_receipts_codes_zatca_check.sql
begin;

insert into auth.users (id, email, aud, role) values
  ('f7000000-0000-0000-0000-000000000001', 'rc1@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f7000000-0000-0000-0000-00000000000a', 'Receipt check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f7000000-0000-0000-0000-000000000001', 'vet', 'f7000000-0000-0000-0000-00000000000a', 'R Manager', 'manager');
insert into owner_files (id, clinic_id, name, phone) values
  ('f7000000-0000-0000-0000-0000000000c1', 'f7000000-0000-0000-0000-00000000000a', 'Noura', '+966501111199');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f7000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_code text := (select invoice_code from branches where clinic_id = 'f7000000-0000-0000-0000-00000000000a' and is_main);
begin
  -- Nothing numbered yet, so the code can change; the change is logged with old -> new.
  update branches set invoice_code = 'RCX' where clinic_id = 'f7000000-0000-0000-0000-00000000000a' and is_main;
  v_code := 'RCX';

  perform public.add_owner_balance('f7000000-0000-0000-0000-0000000000c1', 50, 'cash');
  perform public.add_owner_balance('f7000000-0000-0000-0000-0000000000c1', 30, 'card');
  assert (select array_agg(receipt_number order by created_at) from owner_balance_entries
          where owner_file_id = 'f7000000-0000-0000-0000-0000000000c1')
         = array['DEP-' || v_code || '-000001', 'DEP-' || v_code || '-000002'],
    'top-ups must get DEP-<code>-000001, -000002';

end $$;
reset role;

do $$
begin
  -- The activity log is admin-only to read, so checked here as the database owner.
  assert exists (select 1 from admin_audit_log where clinic_id = 'f7000000-0000-0000-0000-00000000000a'
                 and action = 'branch_invoice_code_changed' and target_label like '% → RCX)'),
    'invoice code change must be logged';
  assert (select count(*) from information_schema.columns where table_name = 'invoices'
          and column_name in ('zatca_uuid', 'zatca_icv', 'zatca_previous_hash')) = 3, 'ZATCA columns must exist';
end $$;

rollback;
select '0070 receipts, code log, ZATCA columns: all checks passed' as result;
