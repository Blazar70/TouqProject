-- Rollback for 0078_appointment_arrived_at.sql. Loses the check-in times.
drop trigger appointments_zz_arrived_at on appointments;
drop function public.set_appointment_arrived_at();
alter table appointments drop column arrived_at;
