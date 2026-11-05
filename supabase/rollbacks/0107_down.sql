-- Undo 0107. Closed appointments go back to requested (a person confirms them again): whether one was
-- requested or confirmed before closing is not kept.
select cron.unschedule('auto-close-forgotten-appointments');
update appointments set status = 'requested', cancellation_category = null where status = 'cancelled' and cancellation_category = 'auto_closed';
delete from admin_audit_log where action = 'appointments_auto_closed';
drop function public.auto_close_forgotten_appointments();
