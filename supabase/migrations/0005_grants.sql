-- Touq / طوق — grant base table permissions to Supabase's built-in roles
-- Run in the Supabase SQL editor after 0004b_admin_policies.sql.
--
-- Row Level Security policies only decide *which rows* a role can touch —
-- the role also needs a base GRANT saying it can touch the table *at all*.
-- These tables were created directly in the SQL editor and never received
-- that base grant, which is why every query was failing with "permission
-- denied for table X" regardless of RLS policy content.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated, service_role;

-- Apply the same grant automatically to any table created by future migrations.
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
