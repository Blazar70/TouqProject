-- Undoes 0046_branch_columns.sql. Run rollbacks newest first (0046, 0045,
-- 0044), each in one transaction: psql "$DATABASE_URL" -1 -f <file>.
-- Loses which branch each appointment/invoice/record was at.

drop trigger appointments_fill_default_branch on appointments;
drop trigger invoices_fill_default_branch on invoices;
drop function public.fill_default_branch();

-- dropping the columns also drops their FKs and appointments_branch_scheduled_idx
alter table appointments drop column branch_id;
alter table invoices drop column branch_id;
alter table medical_records drop column branch_id;
alter table pets drop column home_branch_id;
