-- Undo 0097. Imported owners and pets stay (they are ordinary rows now).
drop function public.admin_import_owners_pets(uuid, jsonb);
