-- Undoes 0052_pet_number.sql: psql "$DATABASE_URL" -1 -f <file>.
-- Every pet's Pet ID is lost; re-applying 0052 numbers them again by created_at.

drop trigger pets_prevent_pet_number_change on pets;
drop trigger pets_assign_pet_number on pets;
drop function public.prevent_pet_number_change();
drop function public.assign_pet_number();

alter table pets drop column pet_number;

drop table pet_number_counters;
