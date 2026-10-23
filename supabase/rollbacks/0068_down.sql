-- Rollback for 0068_credit_note_roles.sql. No data changes.
drop trigger if exists credit_notes_enforce_role on credit_notes;
drop function if exists public.enforce_credit_note_role();
