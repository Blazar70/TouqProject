-- Rollback for 0063_owner_files.sql (run 0064_down.sql first).
-- Loses: owner files (notes, the grouping). The pets keep their owner text,
-- which the triggers kept equal to the owner files.
drop trigger if exists owner_files_sync_pets on owner_files;
drop trigger if exists pets_push_owner_text on pets;
drop trigger if exists pets_sync_owner_file on pets;
drop function if exists public.owner_files_sync_pets();
drop function if exists public.pets_push_owner_text();
drop function if exists public.pets_sync_owner_file();
alter table pets drop column owner_file_id;
drop table if exists owner_files;
drop function if exists public.owner_phone_key(text);
