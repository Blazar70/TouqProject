-- Touq / طوق — add an admin role with full cross-clinic access
-- Run in the Supabase SQL editor after 0003_signup_policies.sql.
--
-- IMPORTANT: run this as its own query, on its own, then run
-- 0004b_admin_policies.sql separately afterwards. Postgres won't let you add
-- a new enum value and use it in the same transaction, and the SQL editor
-- runs everything you paste as one transaction — hence the split.

alter type user_role add value 'admin';
