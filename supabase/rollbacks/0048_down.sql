-- Undoes 0048_branch_management.sql: psql "$DATABASE_URL" -1 -f <file>.
-- Branch data (closed branches, which one is main) is kept as is.

drop function public.admin_close_branch(uuid);
drop function public.admin_set_main_branch(uuid);
alter table branches drop constraint branches_main_is_active;
drop index branches_unique_name_per_clinic;
