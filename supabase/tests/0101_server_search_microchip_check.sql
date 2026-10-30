-- Checks for migration 0101 (server search, microchip, import skipped rows). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0101_server_search_microchip_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f1010000-0000-0000-0000-000000000001', 'a101@check.local', 'authenticated', 'authenticated'),
  ('f1010000-0000-0000-0000-000000000002', 'v101@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f1010000-0000-0000-0000-00000000000a', '0101 check'),
  ('f1010000-0000-0000-0000-00000000000b', '0101 other');
insert into profiles (id, role, full_name) values ('f1010000-0000-0000-0000-000000000001', 'admin', 'A');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f1010000-0000-0000-0000-000000000002', 'vet', 'f1010000-0000-0000-0000-00000000000a', 'V', 'manager');
insert into owner_files (id, clinic_id, name, phone) values
  ('f1010000-0000-0000-0000-0000000000f1', 'f1010000-0000-0000-0000-00000000000a', 'أحمد الزهراني', '+966501010101'),
  ('f1010000-0000-0000-0000-0000000000f2', 'f1010000-0000-0000-0000-00000000000b', 'أحمد آخر', '+966502020202');
insert into pets (id, clinic_id, owner_file_id, owner_name, owner_phone, name, species, microchip) values
  ('f1010000-0000-0000-0000-0000000000a1', 'f1010000-0000-0000-0000-00000000000a', 'f1010000-0000-0000-0000-0000000000f1', 'أحمد الزهراني', '+966501010101', 'ياسمينة', 'Cat', '982000123456789'),
  ('f1010000-0000-0000-0000-0000000000a2', 'f1010000-0000-0000-0000-00000000000b', 'f1010000-0000-0000-0000-0000000000f2', 'أحمد آخر', '+966502020202', 'ياسمينة', 'Cat', null);

do $$
begin
  insert into pets (clinic_id, owner_file_id, owner_name, name, species, microchip)
  values ('f1010000-0000-0000-0000-00000000000a', 'f1010000-0000-0000-0000-0000000000f1', 'x', 'Bad chip', 'Dog', '12345');
  assert false, 'a 5-digit microchip must be refused';
exception when check_violation then null;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1010000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  -- Plain alef, taa marbuta written as haa: still finds "ياسمينة" of "أحمد"; only this clinic's pet (RLS).
  assert (select count(*) from pets where search_text ilike '%' || public.search_norm('احمد') || '%') = 1, 'owner name search, one clinic';
  assert (select count(*) from pets where search_text ilike '%ياسمينه%') = 1, 'taa marbuta folded';
  assert (select count(*) from pets where search_text ilike '%501010101%') = 1, 'phone digits';
  assert (select count(*) from pets where search_text ilike '%123456789%') = 1, 'microchip';
  assert (select count(*) from owner_files where search_text ilike '%' || public.search_norm('احمد') || '%') = 1, 'owner search, one clinic';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'f1010000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb;
begin
  v := public.admin_import_owners_pets('f1010000-0000-0000-0000-00000000000a', '[
    {"owner_name": "A", "owner_phone": "+966501010101", "pet_name": "ياسمينة", "species": "Cat"},
    {"owner_name": "B", "pet_name": "Rex", "species": "Dog", "microchip": "abc1234567"},
    {"owner_name": "A", "owner_phone": "+966501010101", "pet_name": "Yasmin", "species": "Cat"}]');
  assert v ->> 'pets' = '2' and v ->> 'skipped' = '1', 'one pet already there: ' || v::text;
  assert v -> 'skipped_rows' = '[1]'::jsonb, 'skipped row numbers: ' || v::text;
  assert (select microchip from pets where name = 'Rex' and clinic_id = 'f1010000-0000-0000-0000-00000000000a') = 'ABC1234567', 'chip upper-cased';
  begin
    perform public.admin_import_owners_pets('f1010000-0000-0000-0000-00000000000a', '[{"owner_name": "C", "pet_name": "Z", "species": "Dog", "microchip": "12"}]');
    assert false, 'a bad microchip must stop the import';
  exception when raise_exception then null;
  end;
end $$;

select 'ok: 0101 checks passed' as result;
rollback;
