-- Touq / طوق — enable pg_cron and pg_net so a scheduled job can call the
-- send-appointment-reminders Edge Function on a timer. The actual
-- cron.schedule(...) call is run separately via the SQL editor rather than
-- a migration, since it needs to embed the service-role key.
create extension if not exists pg_cron;
create extension if not exists pg_net;
