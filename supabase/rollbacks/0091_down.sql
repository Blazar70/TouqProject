-- Rollback for 0091_hospital_night_manager_only.sql.
drop trigger services_hospital_night_guard on services;
drop function public.services_hospital_night_guard();
