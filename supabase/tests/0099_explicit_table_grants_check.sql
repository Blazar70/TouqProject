-- Checks for migration 0099 (explicit table grants). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0099_explicit_table_grants_check.sql
-- Simulates a project without the old default grants: strip table access from the API roles, re-apply 0099,
-- and compare with what was there before. One transaction, rolled back at the end.
begin;

create temp table before_grants as
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('authenticated', 'service_role') and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  and table_name in (select tablename from pg_tables where schemaname = 'public');

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke select, insert, update, delete on public.%I from authenticated, service_role', t);
  end loop;
end $$;

\i supabase/migrations/0099_explicit_table_grants.sql

do $$
declare
  v_missing int;
  v_extra int;
begin
  select count(*) into v_missing from (
    select * from before_grants
    except
    select table_name, grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('authenticated', 'service_role')) m;
  select count(*) into v_extra from (
    select table_name, grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('authenticated', 'service_role') and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      and table_name in (select tablename from pg_tables where schemaname = 'public')
    except select * from before_grants) e;
  assert v_missing = 0, v_missing || ' table grants missing after 0099';
  assert v_extra = 0, v_extra || ' table grants more than before';
end $$;

rollback;
