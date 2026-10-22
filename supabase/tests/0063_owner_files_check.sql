-- Checks for migration 0063 (owner files, phone grouping backfill, sync to pet text).
-- RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0063_owner_files_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

-- Backfill, on the real staging rows: every pet has an owner of its own clinic,
-- one owner per phone key per clinic, and the pet text equals its owner file.
do $$
begin
  assert not exists (select 1 from pets where owner_file_id is null), 'pet without owner file';
  assert not exists (select 1 from pets p join owner_files o on o.id = p.owner_file_id where o.clinic_id <> p.clinic_id), 'owner of another clinic';
  assert not exists (
    select 1 from pets p group by p.clinic_id, coalesce(public.owner_phone_key(p.owner_phone), p.id::text)
    having count(distinct p.owner_file_id) > 1), 'one phone split over several owners';
  assert not exists (select 1 from pets p group by p.owner_file_id having count(distinct coalesce(public.owner_phone_key(p.owner_phone), p.id::text)) > 1),
    'one owner holds different phones';
  assert not exists (
    select 1 from pets p join owner_files o on o.id = p.owner_file_id
    where (p.owner_name, p.owner_phone, p.owner_email) is distinct from (o.name, o.phone, o.email)), 'pet text out of sync';
  assert public.owner_phone_key('+966501234567') = '501234567' and public.owner_phone_key('0501234567') = '501234567'
    and public.owner_phone_key(null) is null, 'phone key differs from src/lib/phone.ts';
end $$;

insert into auth.users (id, email, aud, role) values
  ('f6300000-0000-0000-0000-000000000001', 'of1@check.local', 'authenticated', 'authenticated'),
  ('f6300000-0000-0000-0000-000000000003', 'of3@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f6300000-0000-0000-0000-00000000000a', 'Owner check A'),
  ('f6300000-0000-0000-0000-00000000000b', 'Owner check B');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6300000-0000-0000-0000-000000000001', 'vet', 'f6300000-0000-0000-0000-00000000000a', 'A Reception', 'receptionist'),
  ('f6300000-0000-0000-0000-000000000003', 'vet', 'f6300000-0000-0000-0000-00000000000b', 'B Manager', 'manager');
insert into owner_files (id, clinic_id, name, phone) values
  ('f6300000-0000-0000-0000-0000000000b0', 'f6300000-0000-0000-0000-00000000000b', 'B Owner', '+966500000099');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f6300000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_owner uuid;
  v_pet1 pets;
  v_pet2 pets;
  v_n integer;
begin
  -- A pet saved the old way (text only) gets an owner file from its text.
  insert into pets (clinic_id, name, species, owner_name, owner_phone)
  values ('f6300000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'Ali', '+966511111111') returning * into v_pet1;
  select id into v_owner from owner_files where id = v_pet1.owner_file_id and name = 'Ali' and phone = '+966511111111';
  assert v_owner is not null, 'no owner file made from pet text';

  -- A pet picked onto an existing owner takes the owner's contact, not its own text.
  insert into pets (clinic_id, name, species, owner_name, owner_file_id)
  values ('f6300000-0000-0000-0000-00000000000a', 'Mia', 'cat', 'ignored', v_owner) returning * into v_pet2;
  assert v_pet2.owner_name = 'Ali' and v_pet2.owner_phone = '+966511111111', 'pet text not taken from owner';

  -- Editing the owner file updates every pet's text.
  update owner_files set name = 'Ali Saleh', email = 'ali@x.sa' where id = v_owner;
  assert (select count(*) from pets where owner_file_id = v_owner and owner_name = 'Ali Saleh' and owner_email = 'ali@x.sa') = 2, 'owner edit not synced to pets';

  -- Editing a pet's owner text (admin page path) edits the owner and the other pet.
  update pets set owner_phone = '+966522222222' where id = v_pet1.id;
  assert (select phone from owner_files where id = v_owner) = '+966522222222', 'pet text edit not pushed to owner';
  assert (select owner_phone from pets where id = v_pet2.id) = '+966522222222', 'sibling pet not synced';

  -- Moving a pet to another owner (split) takes that owner's contact.
  insert into owner_files (clinic_id, name, phone) values ('f6300000-0000-0000-0000-00000000000a', 'Huda', '+966533333333') returning id into v_owner;
  update pets set owner_file_id = v_owner where id = v_pet2.id;
  select * into v_pet2 from pets where id = v_pet2.id;
  assert v_pet2.owner_name = 'Huda' and v_pet2.owner_phone = '+966533333333' and v_pet2.owner_email is null, 'moved pet text not synced';
  assert (select owner_name from pets where id = v_pet1.id) = 'Ali Saleh', 'other pet changed by the move';

  -- Same clinic only: no reading, editing or linking another clinic's owner.
  assert not exists (select 1 from owner_files where id = 'f6300000-0000-0000-0000-0000000000b0'), 'saw clinic B owner';
  update owner_files set name = 'hacked' where id = 'f6300000-0000-0000-0000-0000000000b0';
  get diagnostics v_n = row_count;
  assert v_n = 0, 'edited clinic B owner';
  begin
    insert into owner_files (clinic_id, name) values ('f6300000-0000-0000-0000-00000000000b', 'x');
    assert false, 'made an owner in clinic B';
  exception when insufficient_privilege then null;
  end;
  begin
    update pets set owner_file_id = 'f6300000-0000-0000-0000-0000000000b0' where id = v_pet1.id;
    assert false, 'linked a pet to clinic B owner';
  exception when foreign_key_violation then null;
  end;
  -- No deleting owner files directly.
  begin
    delete from owner_files where id = v_owner;
    assert false, 'client deleted an owner file';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  assert (select name from owner_files where id = 'f6300000-0000-0000-0000-0000000000b0') = 'B Owner', 'clinic B owner changed';
end $$;

select 'all 0063 checks passed' as result;
rollback;
