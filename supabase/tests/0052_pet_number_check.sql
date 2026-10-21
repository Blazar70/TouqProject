-- Checks for migration 0052 (pet_number). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0052_pet_number_check.sql
-- One transaction, rolled back at the end.

begin;

do $$
declare
  v_clinic uuid;
  v_first integer;
  v_a uuid;
  v_b uuid;
  v_na integer;
  v_nb integer;
begin
  assert not exists (select 1 from pets where pet_number is null), 'a pet has no number';
  assert not exists (
    select 1 from pets group by clinic_id having min(pet_number) <> 10001
  ), 'a clinic does not start at 10001';
  assert not exists (
    select 1 from pet_number_counters c
    where c.last_number < (select max(pet_number) from pets p where p.clinic_id = c.clinic_id)
  ), 'a counter is behind its pets';

  select clinic_id, min(pet_number) into v_clinic, v_first from pets group by clinic_id limit 1;
  assert v_clinic is not null, 'no pets to test with';
  assert (select pet_number from pets where clinic_id = v_clinic order by created_at, id limit 1) = v_first,
    'backfill is not in created_at order';

  -- A client-sent number is ignored.
  insert into pets (clinic_id, name, species, owner_name, pet_number)
  values (v_clinic, 'check a', 'cat', 'check', 1)
  returning id, pet_number into v_a, v_na;
  assert v_na > 10000, 'client-sent pet_number was kept';

  -- A deleted pet's number is not reused.
  delete from pets where id = v_a;
  insert into pets (clinic_id, name, species, owner_name)
  values (v_clinic, 'check b', 'cat', 'check')
  returning id, pet_number into v_b, v_nb;
  assert v_nb = v_na + 1, 'number reused or skipped after delete';

  begin
    update pets set pet_number = 99999 where id = v_b;
    assert false, 'pet_number update accepted';
  exception when raise_exception then null;
  end;
end $$;

-- Clients cannot touch the counter table.
set local role authenticated;
do $$
begin
  begin
    perform 1 from pet_number_counters;
    assert false, 'authenticated can read pet_number_counters';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
