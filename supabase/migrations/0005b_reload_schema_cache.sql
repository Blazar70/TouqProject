-- Touq / طوق — force the API layer to reload its cached table permissions
-- Run in the Supabase SQL editor after 0005_grants.sql, if access still
-- fails with "permission denied" despite the grants having been applied.
notify pgrst, 'reload schema';
