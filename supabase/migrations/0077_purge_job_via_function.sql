-- Touq / طوق — the nightly trash purge now calls admin-manage-clinic (action purge_expired)
-- instead of deleting pets in plain SQL (0047). SQL can't remove Storage files
-- (storage.objects has protect_objects_delete), so purged pets left their photos behind
-- (nightly S9). The function deletes expired pets AND their photo files, then expired clinics.
--
-- Needs two Vault secrets per project, set once in the SQL editor (never in a migration):
--   select vault.create_secret('https://<ref>.supabase.co', 'touq_project_url');
--   select vault.create_secret('<same value as the CRON_PURGE_SECRET function secret>', 'cron_purge_secret');
-- and admin-manage-clinic deployed with --no-verify-jwt (it checks the caller itself;
-- the gateway can't verify the new-style keys).
select cron.schedule(
  'purge-trashed-pets-and-staff',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'touq_project_url') || '/functions/v1/admin-manage-clinic',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_purge_secret')
    ),
    body := '{"action":"purge_expired"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
