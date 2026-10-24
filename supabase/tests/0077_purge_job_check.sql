-- Checks for migration 0077 (nightly purge calls the function). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0077_purge_job_check.sql
-- Read-only. The end-to-end run (pet + photo really gone) is driven by hand: see HANDOFF.
begin;

do $$
begin
  assert (select count(*) from cron.job where jobname = 'purge-trashed-pets-and-staff') = 1, 'one purge job';
  assert (select command from cron.job where jobname = 'purge-trashed-pets-and-staff') like '%purge_expired%', 'job calls purge_expired';
  assert (select command from cron.job where jobname = 'purge-trashed-pets-and-staff') not like '%delete from pets%', 'job no longer deletes in SQL';
  assert exists (select 1 from vault.decrypted_secrets where name = 'touq_project_url'), 'vault secret touq_project_url is set';
  assert exists (select 1 from vault.decrypted_secrets where name = 'cron_purge_secret'), 'vault secret cron_purge_secret is set';
end $$;

rollback;
