-- Checks for migration 0090 (owner anonymise clears old log labels; admin can use it). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0090_owner_anonymise_log_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 manager, 2 platform admin.
insert into auth.users (id, email, aud, role) values
  ('f9000000-0000-0000-0000-000000000001', 'm90@check.local', 'authenticated', 'authenticated'),
  ('f9000000-0000-0000-0000-000000000002', 'a90@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f9000000-0000-0000-0000-00000000000a', '0090 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f9000000-0000-0000-0000-000000000001', 'vet', 'f9000000-0000-0000-0000-00000000000a', 'M', 'manager');
insert into profiles (id, role, full_name) values ('f9000000-0000-0000-0000-000000000002', 'admin', 'A');
insert into owner_files (id, clinic_id, name, phone) values
  ('f9000000-0000-0000-0000-0000000000f1', 'f9000000-0000-0000-0000-00000000000a', 'Real Name', '+966501110001'),
  ('f9000000-0000-0000-0000-0000000000f2', 'f9000000-0000-0000-0000-00000000000a', 'Second Owner', '+966501110002');
insert into admin_audit_log (actor_name, action, target_type, target_label, clinic_id) values
  ('M', 'balance_top_up', 'owner', 'Real Name · 500.00 · cash', 'f9000000-0000-0000-0000-00000000000a'),
  ('M', 'owners_merged', 'owner', 'Dup Name → Real Name · 2', 'f9000000-0000-0000-0000-00000000000a'),
  ('M', 'balance_adjusted', 'owner', 'Dup Name · 100.00 · refund', 'f9000000-0000-0000-0000-00000000000a'),
  ('M', 'balance_top_up', 'owner', 'Other Real Name · 10.00 · cash', 'f9000000-0000-0000-0000-00000000000a');

set local role authenticated;

-- Manager: the owner's name and the merged duplicate's name leave the log; a different owner's row stays.
select set_config('request.jwt.claims', json_build_object('sub', 'f9000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  perform public.anonymise_owner_file('f9000000-0000-0000-0000-0000000000f1');
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from admin_audit_log where clinic_id = 'f9000000-0000-0000-0000-00000000000a'
                     and (target_label like 'Real Name%' or target_label like '%→ Real Name%' or target_label like '%Dup Name%')),
    'old log rows must not keep the real or merged name';
  assert exists (select 1 from admin_audit_log where target_label = 'Deleted owner #f90000 · 500.00 · cash'), 'balance row keeps its amount';
  assert exists (select 1 from admin_audit_log where target_label = 'Deleted owner #f90000 → Deleted owner #f90000 · 2'), 'merge row anonymised';
  assert exists (select 1 from admin_audit_log where target_label = 'Other Real Name · 10.00 · cash'), 'another owner''s row stays';
end $$;

-- Platform admin (no clinic of their own) can anonymise too.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  perform public.anonymise_owner_file('f9000000-0000-0000-0000-0000000000f2');
  assert (select anonymised_at is not null from owner_files where id = 'f9000000-0000-0000-0000-0000000000f2'), 'admin must anonymise';
end $$;

rollback;
