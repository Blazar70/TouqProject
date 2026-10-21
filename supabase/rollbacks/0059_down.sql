-- Rollback for 0059_visit_services.sql (drops every visit's services).
drop table if exists appointment_services;
drop function if exists public.appointment_services_guard();
alter table invoices drop constraint if exists invoices_appointment_id_key;
