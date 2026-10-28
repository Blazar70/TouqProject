-- Checks for migration 0094 (Unpaid report skips a fully credited visit). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0094_unpaid_skips_credited_visits_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f9400000-0000-0000-0000-000000000001', 'm94@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f9400000-0000-0000-0000-00000000000a', '0094 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f9400000-0000-0000-0000-000000000001', 'vet', 'f9400000-0000-0000-0000-00000000000a', 'M', 'manager');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f9400000-0000-0000-0000-0000000000c1', 'f9400000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');
insert into appointments (id, pet_id, clinic_id, scheduled_at, created_by, status) values
  ('f9400000-0000-0000-0000-0000000000a1', 'f9400000-0000-0000-0000-0000000000c1', 'f9400000-0000-0000-0000-00000000000a', now(),
   'f9400000-0000-0000-0000-000000000001', 'completed');
select set_config('check.branch', (select id::text from branches where clinic_id = 'f9400000-0000-0000-0000-00000000000a' and is_main), true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9400000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_lines jsonb := '[{"description": "Exam", "unit_price": 100, "quantity": 1}]';
  v_branch uuid := current_setting('check.branch')::uuid;
  v_visit uuid := 'f9400000-0000-0000-0000-0000000000a1';
  v_bill uuid;
begin
  assert exists (select 1 from public.report_unpaid() where kind = 'visit' and id = v_visit), 'an unbilled visit is listed';
  v_bill := public.create_invoice('f9400000-0000-0000-0000-0000000000c1', v_branch, v_visit, null, v_lines, null, '[]');
  assert not exists (select 1 from public.report_unpaid() where kind = 'visit' and id = v_visit), 'a billed visit is not listed';
  perform public.create_credit_note(v_bill, null, (select amount_total from invoices where id = v_bill), 'Visit made free', 'cash');
  assert not exists (select 1 from public.report_unpaid() where kind = 'visit' and id = v_visit), 'a fully credited visit must not be listed';
  assert not exists (select 1 from public.report_unpaid() where kind = 'invoice' and id = v_bill), 'the credited bill is not listed';
  assert not (select public.billed(a) from appointments a where id = v_visit), 'the visit can still be billed again';
end $$;

rollback;
