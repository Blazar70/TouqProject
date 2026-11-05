-- Checks for migration 0106 (diagnosis list + report). RUN ON STAGING ONLY; one transaction, rolled back at the end.
begin;

insert into auth.users (id, email, aud, role) values
  ('f1040000-0000-0000-0000-000000000001', 'm104@check.local', 'authenticated', 'authenticated'),
  ('f1040000-0000-0000-0000-000000000002', 'r104@check.local', 'authenticated', 'authenticated'),
  ('f1040000-0000-0000-0000-000000000003', 'n104@check.local', 'authenticated', 'authenticated'),
  ('f1040000-0000-0000-0000-000000000004', 'd104@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f1040000-0000-0000-0000-00000000000a', '0104 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f1040000-0000-0000-0000-000000000001', 'vet', 'f1040000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f1040000-0000-0000-0000-000000000002', 'vet', 'f1040000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f1040000-0000-0000-0000-000000000003', 'vet', 'f1040000-0000-0000-0000-00000000000a', 'N', 'nurse'),
  ('f1040000-0000-0000-0000-000000000004', 'vet', 'f1040000-0000-0000-0000-00000000000a', 'D', 'doctor');
insert into pets (id, clinic_id, name, species, owner_name, owner_phone) values
  ('f1040000-0000-0000-0000-0000000000c1', 'f1040000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner', '+966501040001');
select set_config('check.branch', (select id::text from branches where clinic_id = 'f1040000-0000-0000-0000-00000000000a' limit 1), true);
insert into staff_branches (profile_id, branch_id)
  select p, current_setting('check.branch')::uuid
  from unnest(array['f1040000-0000-0000-0000-000000000002', 'f1040000-0000-0000-0000-000000000003', 'f1040000-0000-0000-0000-000000000004']::uuid[]) p;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1040000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    insert into diagnosis_terms (clinic_id, name_en, name_ar) values ('f1040000-0000-0000-0000-00000000000a', 'No', 'لا');
    assert false, 'a receptionist added a term';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1040000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
insert into diagnosis_terms (id, clinic_id, name_en, name_ar) values ('f1040000-0000-0000-0000-0000000000d1', 'f1040000-0000-0000-0000-00000000000a', 'Otitis', 'التهاب الأذن');
do $$ begin
  begin
    insert into diagnosis_terms (clinic_id, name_en, name_ar) values ('f1040000-0000-0000-0000-00000000000a', ' otitis ', 'آخر');
    assert false, 'a duplicate term was accepted';
  exception when unique_violation then null;
  end;
end $$;
-- Exact text in either language links, the client can't choose, other text stays typed by hand.
insert into medical_records (id, pet_id, clinic_id, branch_id, diagnosis) values
  ('f1040000-0000-0000-0000-0000000000a1', 'f1040000-0000-0000-0000-0000000000c1', 'f1040000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid, ' OTITIS '),
  ('f1040000-0000-0000-0000-0000000000a2', 'f1040000-0000-0000-0000-0000000000c1', 'f1040000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid, 'التهاب الأذن'),
  ('f1040000-0000-0000-0000-0000000000a3', 'f1040000-0000-0000-0000-0000000000c1', 'f1040000-0000-0000-0000-00000000000a', current_setting('check.branch')::uuid, 'Something else');
do $$ begin
  assert (select count(*) from medical_records where id in ('f1040000-0000-0000-0000-0000000000a1', 'f1040000-0000-0000-0000-0000000000a2') and diagnosis_term_id = 'f1040000-0000-0000-0000-0000000000d1') = 2, 'exact text did not link';
  assert (select diagnosis_term_id from medical_records where id = 'f1040000-0000-0000-0000-0000000000a3') is null, 'other text linked';
end $$;
update medical_records set diagnosis_term_id = 'f1040000-0000-0000-0000-0000000000d1' where id = 'f1040000-0000-0000-0000-0000000000a3';
-- Renaming and archiving keep the link, also when a form re-sends the same text.
update diagnosis_terms set name_en = 'Ear infection', active = false where id = 'f1040000-0000-0000-0000-0000000000d1';
update medical_records set diagnosis = ' OTITIS ' where id = 'f1040000-0000-0000-0000-0000000000a1';
do $$ begin
  assert (select diagnosis_term_id from medical_records where id = 'f1040000-0000-0000-0000-0000000000a3') is null, 'the client set the term';
  assert (select diagnosis_term_id from medical_records where id = 'f1040000-0000-0000-0000-0000000000a1') = 'f1040000-0000-0000-0000-0000000000d1', 'same text lost its link';
  begin
    perform * from public.report_top_diagnoses(current_date, current_date);
    assert false, 'a doctor read the manager report';
  exception when others then
    if sqlerrm not like 'Only managers%' then raise; end if;
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1040000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$ begin
  assert (select visits from public.report_top_diagnoses((now() at time zone 'Asia/Riyadh')::date, (now() at time zone 'Asia/Riyadh')::date) where term_id = 'f1040000-0000-0000-0000-0000000000d1') = 2, 'the report miscounted the term';
  assert (select visits from public.report_top_diagnoses((now() at time zone 'Asia/Riyadh')::date, (now() at time zone 'Asia/Riyadh')::date) where term_id is null) = 1, 'the report miscounted typed visits';
end $$;
rollback;
