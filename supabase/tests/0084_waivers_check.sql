-- Checks for migration 0084 (waivers). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0084_waivers_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 receptionist, 2 nurse, 3 manager of clinic a; 4 manager of clinic b.
insert into auth.users (id, email, aud, role) values
  ('f8400000-0000-0000-0000-000000000001', 'r84@check.local', 'authenticated', 'authenticated'),
  ('f8400000-0000-0000-0000-000000000002', 'n84@check.local', 'authenticated', 'authenticated'),
  ('f8400000-0000-0000-0000-000000000003', 'm84@check.local', 'authenticated', 'authenticated'),
  ('f8400000-0000-0000-0000-000000000004', 'o84@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f8400000-0000-0000-0000-00000000000a', '0084 check a'),
  ('f8400000-0000-0000-0000-00000000000b', '0084 check b');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8400000-0000-0000-0000-000000000001', 'vet', 'f8400000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f8400000-0000-0000-0000-000000000002', 'vet', 'f8400000-0000-0000-0000-00000000000a', 'N', 'nurse'),
  ('f8400000-0000-0000-0000-000000000003', 'vet', 'f8400000-0000-0000-0000-00000000000a', 'M', 'manager'),
  ('f8400000-0000-0000-0000-000000000004', 'vet', 'f8400000-0000-0000-0000-00000000000b', 'O', 'manager');
delete from staff_branches where profile_id::text like 'f8400000-%';
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f8400000-0000-0000-0000-000000000001', 'f8400000-0000-0000-0000-000000000002']::uuid[]) p
  where b.clinic_id = 'f8400000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f8400000-0000-0000-0000-0000000000c1', 'f8400000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner'),
  ('f8400000-0000-0000-0000-0000000000c2', 'f8400000-0000-0000-0000-00000000000a', 'Other pet', 'cat', 'Owner');
insert into appointments (id, clinic_id, pet_id, scheduled_at, branch_id, created_by)
  select 'f8400000-0000-0000-0000-0000000000a2', 'f8400000-0000-0000-0000-00000000000a', 'f8400000-0000-0000-0000-0000000000c2', now(), id, 'f8400000-0000-0000-0000-000000000001'
  from branches where clinic_id = 'f8400000-0000-0000-0000-00000000000a' and is_main;
select set_config('check.branch', (select id::text from branches where clinic_id = 'f8400000-0000-0000-0000-00000000000a' and is_main), true);

set local role authenticated;

-- Receptionist can't write templates; manager can.
select set_config('request.jwt.claims', json_build_object('sub', 'f8400000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into waiver_templates (clinic_id, title_en, title_ar, body_en, body_ar) values ('f8400000-0000-0000-0000-00000000000a', 'x', 'x', 'x', 'x');
    assert false, 'receptionist must not add templates';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'f8400000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
insert into waiver_templates (id, clinic_id, title_en, title_ar, body_en, body_ar)
  values ('f8400000-0000-0000-0000-0000000000f1', 'f8400000-0000-0000-0000-00000000000a', 'Surgery', 'جراحة', 'English text', 'نص عربي');

-- Manager of clinic b sees no templates of clinic a.
select set_config('request.jwt.claims', json_build_object('sub', 'f8400000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from waiver_templates where clinic_id = 'f8400000-0000-0000-0000-00000000000a') = 0, 'other clinic must not see templates';
end $$;

-- Receptionist signs: text comes from the template (Arabic), who/when from the database.
select set_config('request.jwt.claims', json_build_object('sub', 'f8400000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into pet_waivers (id, clinic_id, pet_id, branch_id, template_id, language, signer_name, signature, title, body, collected_by)
  values ('f8400000-0000-0000-0000-0000000000e1', 'f8400000-0000-0000-0000-00000000000a', 'f8400000-0000-0000-0000-0000000000c1',
    current_setting('check.branch')::uuid, 'f8400000-0000-0000-0000-0000000000f1', 'ar', 'Owner', 'data:image/png;base64,AAAA',
    'forged title', 'forged body', 'f8400000-0000-0000-0000-000000000003');
do $$
begin
  assert (select title = 'جراحة' and body = 'نص عربي' and collected_by = 'f8400000-0000-0000-0000-000000000001'
          from pet_waivers where id = 'f8400000-0000-0000-0000-0000000000e1'), 'text and collector must come from the database';
  -- Visit of another pet is refused.
  begin
    insert into pet_waivers (clinic_id, pet_id, branch_id, template_id, language, signer_name, signature, appointment_id)
      values ('f8400000-0000-0000-0000-00000000000a', 'f8400000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid,
        'f8400000-0000-0000-0000-0000000000f1', 'en', 'Owner', 'data:image/png;base64,AAAA', 'f8400000-0000-0000-0000-0000000000a2');
    assert false, 'visit of another pet must be refused';
  exception when raise_exception then null;
  end;
  -- Only PNG data URLs.
  begin
    insert into pet_waivers (clinic_id, pet_id, branch_id, template_id, language, signer_name, signature)
      values ('f8400000-0000-0000-0000-00000000000a', 'f8400000-0000-0000-0000-0000000000c1', current_setting('check.branch')::uuid,
        'f8400000-0000-0000-0000-0000000000f1', 'en', 'Owner', 'https://evil.example/x.png');
    assert false, 'non-PNG signature must be refused';
  exception when check_violation then null;
  end;
end $$;

-- Nurse can't void (no row updated).
select set_config('request.jwt.claims', json_build_object('sub', 'f8400000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
update pet_waivers set voided_at = now(), void_reason = 'x' where id = 'f8400000-0000-0000-0000-0000000000e1';
do $$
begin
  assert (select voided_at is null from pet_waivers where id = 'f8400000-0000-0000-0000-0000000000e1'), 'nurse must not void';
  begin
    update pet_waivers set body = 'changed' where id = 'f8400000-0000-0000-0000-0000000000e1';
    assert false, 'the text must not be editable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Manager voids with a reason; voiding again is refused.
select set_config('request.jwt.claims', json_build_object('sub', 'f8400000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    update pet_waivers set voided_at = now() where id = 'f8400000-0000-0000-0000-0000000000e1';
    assert false, 'void needs a reason';
  exception when check_violation then null;
  end;
  update pet_waivers set voided_at = now(), void_reason = 'Wrong pet' where id = 'f8400000-0000-0000-0000-0000000000e1';
  assert (select voided_by = 'f8400000-0000-0000-0000-000000000003' from pet_waivers where id = 'f8400000-0000-0000-0000-0000000000e1'), 'voided_by must be the manager';
  begin
    update pet_waivers set void_reason = 'other' where id = 'f8400000-0000-0000-0000-0000000000e1';
    assert false, 'a voided waiver must stay as it is';
  exception when raise_exception then null;
  end;
end $$;

rollback;
