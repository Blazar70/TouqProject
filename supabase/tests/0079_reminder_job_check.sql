-- Checks for migration 0079 (reminder job via Vault). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0079_reminder_job_check.sql
-- Read-only. That the function accepts the call is checked by hand (net._http_response, see HANDOFF).
begin;

do $$
begin
  assert (select count(*) from cron.job where jobname = 'send-appointment-reminders') = 1, 'one reminder job';
  assert (select schedule from cron.job where jobname = 'send-appointment-reminders') = '*/15 * * * *', 'every 15 minutes';
  assert (select command from cron.job where jobname = 'send-appointment-reminders') like '%x-cron-secret%', 'sends the cron secret';
  assert (select command from cron.job where jobname = 'send-appointment-reminders') not like '%Bearer%', 'no key in the job';
  assert not exists (select 1 from cron.job where jobname = 'purge-expired-clinics'), 'old purge job removed';
end $$;

rollback;
