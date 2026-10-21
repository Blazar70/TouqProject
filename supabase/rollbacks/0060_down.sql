-- Rollback for 0060_invoice_numbers.sql (run 0061_down.sql first).
-- Drops every invoice number and branch invoice code; the numbers are gone for good.
drop trigger if exists invoices_set_number on invoices;
drop function if exists public.assign_document_number();
alter table invoices drop column if exists invoice_number;
drop trigger if exists branches_invoice_code_guard on branches;
drop function if exists public.branch_invoice_code_guard();
drop table if exists invoice_counters;
alter table branches drop column if exists invoice_code;
drop function if exists public.default_invoice_code(uuid, text);
