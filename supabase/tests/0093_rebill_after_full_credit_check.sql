-- Checks for migration 0093 (a fully credited bill frees its visit or stay). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0093_rebill_after_full_credit_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f9300000-0000-0000-0000-000000000001', 'm93@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f9300000-0000-0000-0000-00000000000a', '0093 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f9300000-0000-0000-0000-000000000001', 'vet', 'f9300000-0000-0000-0000-00000000000a', 'M', 'manager');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f9300000-0000-0000-0000-0000000000c1', 'f9300000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');
insert into inpatient_stays (id, clinic_id, pet_id, branch_id, discharged_at)
  select 'f9300000-0000-0000-0000-0000000000e1', 'f9300000-0000-0000-0000-00000000000a', 'f9300000-0000-0000-0000-0000000000c1', id, now()
  from branches where clinic_id = 'f9300000-0000-0000-0000-00000000000a' and is_main;
insert into appointments (id, pet_id, clinic_id, scheduled_at, created_by, status) values
  ('f9300000-0000-0000-0000-0000000000a1', 'f9300000-0000-0000-0000-0000000000c1', 'f9300000-0000-0000-0000-00000000000a', now(),
   'f9300000-0000-0000-0000-000000000001', 'completed');
select set_config('check.branch', (select id::text from branches where clinic_id = 'f9300000-0000-0000-0000-00000000000a' and is_main), true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9300000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_lines jsonb := '[{"description": "Night", "unit_price": 100, "quantity": 3}]';
  v_branch uuid := current_setting('check.branch')::uuid;
  v_stay uuid := 'f9300000-0000-0000-0000-0000000000e1';
  v_visit uuid := 'f9300000-0000-0000-0000-0000000000a1';
  v_first uuid;
  v_second uuid;
  v_total numeric;
begin
  -- Stay: partly credited still blocks a second bill; fully credited frees the stay.
  v_first := public.create_invoice('f9300000-0000-0000-0000-0000000000c1', v_branch, null, null, v_lines, null, '[]', now(), v_stay);
  v_total := (select amount_total from invoices where id = v_first);
  perform public.create_credit_note(v_first, null, 50, 'Wrong nights', 'cash');
  begin
    perform public.create_invoice('f9300000-0000-0000-0000-0000000000c1', v_branch, null, null, v_lines, null, '[]', now(), v_stay);
    assert false, 'a partly credited stay bill must block a second one';
  exception when unique_violation then null;
  end;
  assert (select stay_id = v_stay from invoices where id = v_first), 'partly credited bill keeps its stay';
  perform public.create_credit_note(v_first, null, v_total - 50, 'Wrong nights', 'cash');
  assert (select stay_id is null and credited_stay_id = v_stay from invoices where id = v_first), 'fully credited bill must free the stay';
  v_second := public.create_invoice('f9300000-0000-0000-0000-0000000000c1', v_branch, null, null, v_lines, null, '[]', now(), v_stay);
  assert (select stay_id = v_stay from invoices where id = v_second), 'the new bill takes the stay';

  -- Visit: billed() and the services lock follow the live bill.
  v_first := public.create_invoice('f9300000-0000-0000-0000-0000000000c1', v_branch, v_visit, null, v_lines, null, '[]');
  assert (select public.billed(a) from appointments a where id = v_visit), 'visit must count as billed';
  perform public.create_credit_note(v_first, null, (select amount_total from invoices where id = v_first), 'Wrong services', 'cash');
  assert not (select public.billed(a) from appointments a where id = v_visit), 'a fully credited visit must count as unbilled';
  assert (select credited_appointment_id = v_visit from invoices where id = v_first), 'the old bill records its visit';
  perform public.create_invoice('f9300000-0000-0000-0000-0000000000c1', v_branch, v_visit, null, v_lines, null, '[]');
end $$;

rollback;
