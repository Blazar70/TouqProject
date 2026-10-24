-- Rollback for 0085_owner_reminders.sql. LOSES the "sent" marks (the reminders reappear as "to send").
drop table owner_reminders_sent;
drop function public.fill_owner_reminder_sent();
