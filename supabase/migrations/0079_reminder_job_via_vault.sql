-- Touq / طوق — the reminder push job (every 15 minutes) as a migration, like the purge job in 0077.
-- It used to be pasted by hand from supabase/cron/*.sql.example with the service-role key in the
-- Authorization header; the new sb_secret_ keys are refused there (Supabase retires the legacy keys
-- by end of 2026). It now sends x-cron-secret from Vault (cron_purge_secret, see 0077), and
-- send-appointment-reminders must be deployed with --no-verify-jwt.
--
-- The hand-made jobs from those examples are removed if a project still has them; 0077 replaced
-- purge-expired-clinics (it already calls purge_expired every night).
select cron.unschedule(jobname) from cron.job where jobname in ('purge-expired-clinics', 'send-appointment-reminders');

select cron.schedule(
  'send-appointment-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'touq_project_url') || '/functions/v1/send-appointment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_purge_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
