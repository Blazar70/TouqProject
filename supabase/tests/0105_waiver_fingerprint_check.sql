-- Checks for migration 0105 (waiver fingerprint). RUN ON STAGING ONLY; one transaction, rolled back at the end.
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
insert into waiver_templates (id, clinic_id, title_en, title_ar, body_en, body_ar) values
  ('f1040000-0000-0000-0000-0000000000e1', 'f1040000-0000-0000-0000-00000000000a', 'T', 'ت', 'Body', 'نص');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1040000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
insert into pet_waivers (id, clinic_id, pet_id, branch_id, template_id, language, title, body, signer_name, signature, fingerprint) values
  ('f1040000-0000-0000-0000-0000000000f1', 'f1040000-0000-0000-0000-00000000000a', 'f1040000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid, 'f1040000-0000-0000-0000-0000000000e1', 'en', 'x', 'x', 'Signer', 'data:image/png;base64,AAAA', 'forged');
do $$
declare w pet_waivers;
begin
  select * into w from pet_waivers where id = 'f1040000-0000-0000-0000-0000000000f1';
  assert w.fingerprint ~ '^[0-9a-f]{64}$', 'the client chose the fingerprint';
  assert public.fingerprint_ok(w), 'a fresh waiver does not match its fingerprint';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1040000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
-- Voiding must not break it; changing the signed text must.
update pet_waivers set voided_at = now(), void_reason = 'test' where id = 'f1040000-0000-0000-0000-0000000000f1';
do $$ begin
  assert (select public.fingerprint_ok(w) from pet_waivers w where id = 'f1040000-0000-0000-0000-0000000000f1'), 'voiding broke the fingerprint';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
alter table pet_waivers disable trigger pet_waivers_fill;
update pet_waivers set body = 'Changed afterwards' where id = 'f1040000-0000-0000-0000-0000000000f1';
alter table pet_waivers enable trigger pet_waivers_fill;
do $$ begin
  assert not (select public.fingerprint_ok(w) from pet_waivers w where id = 'f1040000-0000-0000-0000-0000000000f1'), 'a changed text still matched';
end $$;
rollback;
