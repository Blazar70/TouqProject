-- Checks for migration 0092 (pets.owner_since). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0092_pet_owner_since_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f9200000-0000-0000-0000-000000000001', 'r92@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f9200000-0000-0000-0000-00000000000a', '0092 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f9200000-0000-0000-0000-000000000001', 'vet', 'f9200000-0000-0000-0000-00000000000a', 'R', 'receptionist');
insert into owner_files (id, clinic_id, name) values
  ('f9200000-0000-0000-0000-0000000000f1', 'f9200000-0000-0000-0000-00000000000a', 'First'),
  ('f9200000-0000-0000-0000-0000000000f2', 'f9200000-0000-0000-0000-00000000000a', 'Second'),
  ('f9200000-0000-0000-0000-0000000000f3', 'f9200000-0000-0000-0000-00000000000a', 'Second (duplicate)');
insert into pets (id, clinic_id, name, species, owner_name, owner_file_id) values
  ('f9200000-0000-0000-0000-0000000000c1', 'f9200000-0000-0000-0000-00000000000a', 'Bella', 'dog', 'First', 'f9200000-0000-0000-0000-0000000000f1'),
  ('f9200000-0000-0000-0000-0000000000c2', 'f9200000-0000-0000-0000-00000000000a', 'Max', 'cat', 'Second (duplicate)', 'f9200000-0000-0000-0000-0000000000f3');
update pets set owner_since = '2020-01-01' where clinic_id = 'f9200000-0000-0000-0000-00000000000a'; -- ignored: not editable
-- Pretend both joined their owners long ago (as the database owner, around the trigger).
alter table pets disable trigger pets_owner_since;
update pets set owner_since = '2024-01-01' where clinic_id = 'f9200000-0000-0000-0000-00000000000a';
alter table pets enable trigger pets_owner_since;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f9200000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  update pets set owner_since = '2020-01-01' where id = 'f9200000-0000-0000-0000-0000000000c1';
  assert (select owner_since = '2024-01-01' from pets where id = 'f9200000-0000-0000-0000-0000000000c1'), 'owner_since must not be editable';

  -- Moving to another owner restarts it.
  update pets set owner_file_id = 'f9200000-0000-0000-0000-0000000000f2' where id = 'f9200000-0000-0000-0000-0000000000c1';
  assert (select owner_since > now() - interval '1 minute' from pets where id = 'f9200000-0000-0000-0000-0000000000c1'), 'a move must restart owner_since';

  -- A merge (same person) keeps it.
  perform public.merge_owner_files('f9200000-0000-0000-0000-0000000000f2', 'f9200000-0000-0000-0000-0000000000f3');
  assert (select owner_file_id = 'f9200000-0000-0000-0000-0000000000f2' and owner_since = '2024-01-01'
          from pets where id = 'f9200000-0000-0000-0000-0000000000c2'), 'a merge must keep owner_since';
  assert coalesce(current_setting('touq.owner_merge', true), '') <> 'on', 'merge flag must be cleared';
end $$;

rollback;
