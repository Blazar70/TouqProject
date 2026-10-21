-- Rollback for 0057_branch_audit_trigger.sql
drop trigger if exists clinics_log_logo_change on clinics;
drop function if exists public.log_clinic_logo_change();
drop trigger if exists branches_log_change on branches;
drop function if exists public.log_branch_change();
