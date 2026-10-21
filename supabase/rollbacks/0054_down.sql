-- Rollback for 0054_clinic_row_guard.sql
drop trigger if exists clinics_enforce_row_update on clinics;
drop function if exists public.enforce_clinic_row_update();
