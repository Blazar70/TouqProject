-- Rollback for 0079_reminder_job_via_vault.sql: removes the reminder job. Deploy the old
-- send-appointment-reminders (Bearer service-role key) and re-create its job by hand if needed;
-- the hand-made jobs 0079 removed are not restored.
select cron.unschedule('send-appointment-reminders');
