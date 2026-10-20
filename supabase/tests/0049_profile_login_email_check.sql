-- Checks for migration 0049 (login email on profiles). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0049_profile_login_email_check.sql
-- One transaction, rolled back at the end.

begin;

do $$
declare
  v_id uuid;
begin
  assert not exists (select 1 from profiles where email like '%@staff.touq.invalid'), 'synthetic address copied';
  assert not exists (
    select 1 from profiles p join auth.users u on u.id = p.id
    where u.email not like '%@staff.touq.invalid' and p.email is distinct from lower(u.email)
  ), 'a real-email login was not copied';

  select id into v_id from profiles where role = 'vet' order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  begin
    update profiles set email = 'hijack@example.com' where id = v_id;
    assert false, 'non-admin changed own login email';
  exception when raise_exception then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    update profiles set email = 'Upper@Example.com' where id = v_id;
    assert false, 'mixed-case email accepted';
  exception when check_violation then null;
  end;

  raise notice '0049 checks passed';
end $$;

rollback;
