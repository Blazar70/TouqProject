-- Rollback for 0089_owner_anonymise.sql. Anonymised owners stay anonymised (the data is gone by design).
drop function public.anonymise_owner_file(uuid);
alter table owner_files drop column anonymised_at;
