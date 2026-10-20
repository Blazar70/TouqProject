-- Undoes 0044_branches.sql. Run after 0045_down.sql, in one transaction:
-- psql "$DATABASE_URL" -1 -f <file>. Loses every branch and membership.

drop trigger clinics_create_main_branch on clinics;
drop function public.create_main_branch();

drop table staff_branches;
drop table branches;

alter table clinics drop column timezone;
