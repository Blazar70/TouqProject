-- Rollback for 0061_invoicing_core.sql. Then 0060_down.sql if wanted.
-- Loses: discounts, part payments (each invoice gets back the method and
-- paid_at of its first payment; unpaid ones become cash), credit notes,
-- clinics.vat_number and max_staff_discount_percent.
drop trigger if exists invoices_log_discount on invoices;
drop trigger if exists invoice_items_log_discount on invoice_items;
drop function if exists public.create_invoice(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, timestamptz);
drop function if exists public.add_invoice_payment(uuid, text, numeric, uuid);
drop function if exists public.create_credit_note(uuid, uuid[], numeric, text, text);
drop function if exists public.refresh_invoice_status(uuid);
drop function if exists public.invoice_discount(numeric, jsonb, numeric);

alter table invoices
  add column method text not null default 'cash' check (method in ('cash', 'card', 'apple_pay')),
  add column status text not null default 'recorded' check (status in ('recorded', 'verified')),
  add column paid_at timestamptz not null default now(),
  add column verified_by uuid references profiles (id),
  add column verified_at timestamptz;
alter table invoices alter column method drop default;
update invoices i set method = p.method, paid_at = p.paid_at, status = 'verified', verified_by = p.received_by, verified_at = p.created_at
from (select distinct on (invoice_id) * from invoice_payments order by invoice_id, paid_at, id) p
where p.invoice_id = i.id;
update invoices set paid_at = created_at where id not in (select invoice_id from invoice_payments);
drop index if exists invoices_clinic_created_at_idx;
create index invoices_clinic_paid_at_idx on invoices (clinic_id, paid_at desc);

drop table if exists credit_notes;
drop table if exists invoice_payments;
drop function if exists public.log_invoice_money();

alter table invoices
  drop column discount_type, drop column discount_value, drop column discount_amount, drop column discount_reason,
  drop column vat_total, drop column amount_paid, drop column amount_credited, drop column amount_refunded, drop column payment_status;
alter table invoice_items
  drop column position, drop column vat_rate, drop column discount_type, drop column discount_value,
  drop column discount_amount, drop column discount_reason, drop column bill_discount_share, drop column vat_amount;

grant insert, update, delete on invoices, invoice_items to anon, authenticated;

-- 0054's version of the clinic guard.
create or replace function public.enforce_clinic_row_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is not null
    and not public.current_user_is_admin()
    and (to_jsonb(new) - array['name', 'phone', 'logo_url'])
      is distinct from (to_jsonb(old) - array['name', 'phone', 'logo_url'])
  then
    raise exception 'only an admin may change this clinic setting';
  end if;
  return new;
end;
$$;
alter table clinics drop column vat_number, drop column max_staff_discount_percent;
