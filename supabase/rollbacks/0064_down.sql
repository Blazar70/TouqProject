-- Rollback for 0064_owner_balance.sql. Then 0063_down.sql if wanted.
-- Loses: every balance and its ledger. Invoice payments and credit-note
-- refunds made with 'balance' become 'cash' so the old method checks hold.
drop function if exists public.merge_owner_files(uuid, uuid);
drop function if exists public.add_owner_balance(uuid, numeric, text, text, uuid);
drop trigger if exists invoice_payments_from_balance on invoice_payments;
drop trigger if exists credit_notes_to_balance on credit_notes;
drop function if exists public.invoice_money_to_balance();
drop table if exists owner_balance_entries;
drop function if exists public.apply_owner_balance_entry();

update invoice_payments set method = 'cash' where method = 'balance';
update credit_notes set refund_method = 'cash' where refund_method = 'balance';
alter table invoice_payments drop constraint invoice_payments_method_check;
alter table invoice_payments add constraint invoice_payments_method_check check (method in ('cash', 'card', 'apple_pay'));
alter table credit_notes drop constraint credit_notes_refund_method_check;
alter table credit_notes add constraint credit_notes_refund_method_check check (refund_method in ('cash', 'card', 'apple_pay'));

alter table owner_files drop column balance;
