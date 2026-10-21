-- Rollback for 0058_doctor_time_off.sql (drops every time-off entry).
drop trigger if exists appointments_enforce_doctor_not_away on appointments;
drop function if exists public.enforce_doctor_not_away();
drop table if exists doctor_time_off;
drop function if exists public.log_doctor_time_off_change();
drop function if exists public.save_doctor_time_off(uuid, uuid, timestamptz, timestamptz, text);
drop function if exists public.doctor_time_off_periods(timestamptz, timestamptz);
drop function if exists public.can_manage_doctor_time_off(uuid);
