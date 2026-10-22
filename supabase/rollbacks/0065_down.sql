-- Rollback for 0065_reports.sql. Read-only functions: nothing is lost.
drop function if exists public.report_vat_summary(date, date, uuid);
drop function if exists public.report_income_branches(date, date, uuid);
drop function if exists public.report_income_services(date, date, uuid);
drop function if exists public.report_credit_lines(date, date, uuid);
drop function if exists public.report_unpaid(uuid, date, date);
drop function if exists public.report_cash_up(date, uuid);
drop function if exists public.report_bounds(date, date);
