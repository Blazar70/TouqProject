-- Touq / طوق — remove the temporary diagnostic function used to debug the
-- missing table grants. Safe to run any time.
drop function if exists public.debug_whoami();
