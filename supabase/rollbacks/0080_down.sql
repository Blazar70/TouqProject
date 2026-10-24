-- Rollback for 0080_manager_overview.sql. No data changes.
drop function public.report_cash_differences(date, date, uuid);
drop policy admin_audit_log_select_clinic_manager on admin_audit_log;
