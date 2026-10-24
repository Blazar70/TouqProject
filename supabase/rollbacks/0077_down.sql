-- Rollback for 0077_purge_job_via_function.sql: back to the 0047 SQL-only job (pets only, photos stay).
-- The Vault secrets are left in place; drop them by hand if wanted.
select cron.schedule(
  'purge-trashed-pets-and-staff',
  '0 3 * * *',
  $$ delete from pets where deleted_at is not null and deleted_at < now() - interval '7 days'; $$
);
