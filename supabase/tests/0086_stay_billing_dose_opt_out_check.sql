-- Checks for migration 0086 (stay billing, dose push opt-out). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0086_stay_billing_dose_opt_out_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 manager, 2 nurse.
insert into auth.users (id, email, aud, role) values
  ('f8600000-0000-0000-0000-000000000001', 'm86@check.local', 'authenticated', 'authenticated'),
  ('f8600000-0000-0000-0000-000000000002', 'n86@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f8600000-0000-0000-0000-00000000000a', '0086 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8600000-0000-0000-0000-000000000001', 'vet', 'f8600000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f8600000-0000-0000-0000-000000000002', 'vet', 'f8600000-0000-0000-0000-00000000000a', 'N', 'nurse');
delete from staff_branches where profile_id::text like 'f8600000-%';
insert into staff_branches (profile_id, branch_id)
  select 'f8600000-0000-0000-0000-000000000002', id from branches where clinic_id = 'f8600000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f8600000-0000-0000-0000-0000000000c1', 'f8600000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner'),
  ('f8600000-0000-0000-0000-0000000000c2', 'f8600000-0000-0000-0000-00000000000a', 'Other pet', 'cat', 'Owner');
insert into services (id, clinic_id, name, price, vat_rate) values
  ('f8600000-0000-0000-0000-0000000000a1', 'f8600000-0000-0000-0000-00000000000a', 'Night', 100, 15),
  ('f8600000-0000-0000-0000-0000000000a2', 'f8600000-0000-0000-0000-00000000000a', 'Night 2', 120, 15);
insert into inpatient_stays (id, clinic_id, pet_id, branch_id)
  select 'f8600000-0000-0000-0000-0000000000e1', 'f8600000-0000-0000-0000-00000000000a', 'f8600000-0000-0000-0000-0000000000c1', id
  from branches where clinic_id = 'f8600000-0000-0000-0000-00000000000a' and is_main;
select set_config('check.branch', (select id::text from branches where clinic_id = 'f8600000-0000-0000-0000-00000000000a' and is_main), true);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f8600000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_lines jsonb := '[{"service_id": "f8600000-0000-0000-0000-0000000000a1", "description": "Night", "unit_price": 115, "quantity": 2}]';
  v_id uuid;
begin
  -- One hospital night per clinic.
  update services set hospital_night = true where id = 'f8600000-0000-0000-0000-0000000000a1';
  begin
    update services set hospital_night = true where id = 'f8600000-0000-0000-0000-0000000000a2';
    assert false, 'only one hospital night per clinic';
  exception when unique_violation then null;
  end;

  -- An open stay can't be billed; another pet's stay can't either.
  begin
    perform public.create_invoice('f8600000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid, null, null, v_lines, null, '[]', now(), 'f8600000-0000-0000-0000-0000000000e1');
    assert false, 'an open stay must not be billed';
  exception when raise_exception then null;
  end;
  update inpatient_stays set discharged_at = now() where id = 'f8600000-0000-0000-0000-0000000000e1';
  begin
    perform public.create_invoice('f8600000-0000-0000-0000-0000000000c2', current_setting('check.branch')::uuid, null, null, v_lines, null, '[]', now(), 'f8600000-0000-0000-0000-0000000000e1');
    assert false, 'another pet''s stay must be refused';
  exception when raise_exception then null;
  end;

  -- Billed once, linked; a second bill for the same stay is refused.
  v_id := public.create_invoice('f8600000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid, null, null, v_lines, null, '[]', now(), 'f8600000-0000-0000-0000-0000000000e1');
  assert (select stay_id = 'f8600000-0000-0000-0000-0000000000e1' and amount_total = 230 from invoices where id = v_id), 'invoice must be linked to the stay at list price';
  begin
    perform public.create_invoice('f8600000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid, null, null, v_lines, null, '[]', now(), 'f8600000-0000-0000-0000-0000000000e1');
    assert false, 'a stay must be billed only once';
  exception when unique_violation then null;
  end;

  -- Old calls without p_stay still work.
  perform public.create_invoice('f8600000-0000-0000-0000-0000000000c2', current_setting('check.branch')::uuid, null, null, v_lines, null, '[]');
end $$;

-- Nurse switches off her own dose pushes (on by default).
select set_config('request.jwt.claims', json_build_object('sub', 'f8600000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select inpatient_dose_push from profiles where id = 'f8600000-0000-0000-0000-000000000002'), 'dose push must default to on';
  update profiles set inpatient_dose_push = false where id = 'f8600000-0000-0000-0000-000000000002';
  assert (select not inpatient_dose_push from profiles where id = 'f8600000-0000-0000-0000-000000000002'), 'staff must be able to switch it off';
end $$;

rollback;
