-- A self-registered account with no profile (public sign-up, nightly/reel check 11-02) reads and writes nothing:
-- every table and view the API roles can select returns 0 rows, and it can't give itself a profile or a clinic.
-- Builds its own data, so it runs on an empty database (CI) and on staging. One transaction, rolled back.
begin;

insert into auth.users (id, email, aud, role) values
  ('f1040000-0000-0000-0000-000000000009', 'stranger@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f1040000-0000-0000-0000-00000000000a', 'Stranger check');
insert into pets (clinic_id, name, species, owner_name, owner_phone) values
  ('f1040000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner', '+966501040104');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f1040000-0000-0000-0000-000000000009', 'role', 'authenticated')::text, true);
do $$
declare
  v record;
  v_rows bigint;
  v_leaks text := '';
  v_read int := 0;
begin
  for v in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
      and has_table_privilege('authenticated', c.oid, 'select')
  loop
    execute format('select count(*) from (select 1 from public.%I limit 1) s', v.relname) into v_rows;
    v_read := v_read + 1;
    if v_rows > 0 then v_leaks := v_leaks || ' ' || v.relname; end if;
  end loop;
  assert v_leaks = '', 'a stranger can read:' || v_leaks;
  assert v_read > 20, 'expected to try the API tables, tried ' || v_read;
  raise notice 'stranger read 0 rows from % tables and views', v_read;

  begin
    insert into profiles (id, role, clinic_id, full_name, clinic_role) values
      ('f1040000-0000-0000-0000-000000000009', 'vet', 'f1040000-0000-0000-0000-00000000000a', 'Me', 'manager');
    assert false, 'a stranger gave itself a clinic';
  exception when insufficient_privilege or raise_exception then null;
  end;
  begin
    insert into clinics (name) values ('Stranger clinic');
    assert false, 'a stranger created a clinic';
  exception when insufficient_privilege or raise_exception then null;
  end;
  begin
    insert into pets (clinic_id, name, species, owner_name) values ('f1040000-0000-0000-0000-00000000000a', 'X', 'dog', 'O');
    assert false, 'a stranger added a pet';
  exception when insufficient_privilege or raise_exception or not_null_violation then null;
  end;
end $$;

rollback;
