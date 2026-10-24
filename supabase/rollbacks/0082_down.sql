-- Rollback for 0082_inpatient_reminders.sql. LOSES every reminder and dose log. Deploy the old
-- send-appointment-reminders first (the new one reads these tables).
drop function public.inpatient_task_slots(timestamptz, timestamptz);
drop table inpatient_task_alerts_sent;
drop table inpatient_task_doses;
drop table inpatient_tasks;
drop function public.fill_inpatient_task_dose();
drop function public.fill_inpatient_task();
