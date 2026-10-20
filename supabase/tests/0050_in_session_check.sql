-- Checks for migration 0050 (in_session status). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0050_in_session_check.sql
-- One transaction, rolled back at the end.

begin;

do $$
declare
  v_id uuid;
begin
  select id into v_id from appointments where status in ('requested', 'confirmed') limit 1;
  assert v_id is not null, 'no open appointment to test with';

  update appointments set status = 'in_session', started_at = now() where id = v_id;
  assert (select status from appointments where id = v_id) = 'in_session', 'in_session not stored';

  begin
    update appointments set status = 'in_progress' where id = v_id;
    assert false, 'unknown status accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
