-- 0074: money only for receptionists and managers (phase 4 part 1, user 2026-10-24).
-- Doctors and nurses see no invoices, payments, credit notes, owner balance ledger or
-- cash counts, can't bill, and get no reports. Reception gets the cash-up and unpaid
-- reports; income and VAT are for managers. Platform admins keep their own policies.
-- Doctors and nurses keep the price list and visit services (appointment_services, 0059).
--
-- shortcut: owner_files.balance (one number per owner) stays readable to all staff at
-- the DB level, hidden in the UI; RLS can't hide one column per clinic role and a
-- column grant breaks every select * on owner_files. Move it to its own table if a
-- doctor must not be able to read it even through the API.

-- Raises unless the caller has one of the roles (or is a platform admin). No logged-in
-- user (service role, postgres, cron) passes: those already bypass RLS.
create function public.require_clinic_role(p_roles text[], p_message text)
returns void
language plpgsql stable
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.current_user_has_role(p_roles) and not public.current_user_is_admin() then
    -- Both texts it is called with are mapped in src/lib/friendlyError.ts.
    raise exception using message = p_message, errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------- reading
drop policy "invoices_all_vet" on invoices;
create policy "invoices_select_money" on invoices for select
  using (clinic_id = (select current_user_clinic_id()) and (select current_user_has_role(array['receptionist', 'manager'])));
-- invoice_items follows: its policy reads invoices, which is now filtered the same way.

drop policy "invoice_payments_select_vet" on invoice_payments;
create policy "invoice_payments_select_money" on invoice_payments for select
  using (clinic_id = (select current_user_clinic_id()) and (select current_user_has_role(array['receptionist', 'manager'])));

drop policy "credit_notes_select_vet" on credit_notes;
create policy "credit_notes_select_money" on credit_notes for select
  using (clinic_id = (select current_user_clinic_id()) and (select current_user_has_role(array['receptionist', 'manager'])));

drop policy "owner_balance_entries_select_vet" on owner_balance_entries;
create policy "owner_balance_entries_select_money" on owner_balance_entries for select
  using (clinic_id = (select current_user_clinic_id()) and (select current_user_has_role(array['receptionist', 'manager'])));

drop policy "cash_counts_all_staff" on cash_counts;
create policy "cash_counts_all_money" on cash_counts for all
  using (clinic_id = (select current_user_clinic_id()) and (select current_user_has_role(array['receptionist', 'manager'])))
  with check (clinic_id = (select current_user_clinic_id()));

-- ---------------------------------------------------------------- writing
-- Bills and payments: a trigger, like 0068 for credit notes, so create_invoice and
-- add_invoice_payment (and any later path) obey it. Deposits and adjustments are
-- already checked in add_owner_balance (0064); cash counts by cash_counts_guard (0071).
create function public.enforce_money_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.require_clinic_role(array['receptionist', 'manager'], 'Only receptionists and managers handle money');
  return new;
end;
$$;

create trigger invoices_enforce_money_role
  before insert on invoices
  for each row execute function public.enforce_money_role();
create trigger invoice_payments_enforce_money_role
  before insert on invoice_payments
  for each row execute function public.enforce_money_role();

-- Is this visit billed? Doctors can't read invoices, but the visit-services lock
-- (appointment_services_guard) still needs showing. PostgREST computed field:
-- select('*, billed') on appointments.
create function public.billed(a appointments)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from invoices i where i.appointment_id = a.id and i.clinic_id = public.current_user_clinic_id());
$$;

-- ---------------------------------------------------------------- reports
-- Every report starts from report_bounds: reception and managers only.
create or replace function public.report_bounds(p_from date, p_to date)
returns table (clinic_id uuid, t0 timestamptz, t1 timestamptz, main_branch uuid)
language sql stable security invoker
set search_path = public
as $$
  select public.require_clinic_role(array['receptionist', 'manager'], 'Only receptionists and managers handle money');
  select c.id, p_from::timestamp at time zone c.timezone, (p_to + 1)::timestamp at time zone c.timezone,
         (select b.id from branches b where b.clinic_id = c.id and b.is_main)
  from clinics c where c.id = public.current_user_clinic_id();
$$;

-- Income and VAT: managers only. Bodies unchanged from 0065, a check line added first.
create or replace function public.report_income_services(p_from date, p_to date, p_branch uuid default null)
returns table (service_id uuid, service_name text, quantity bigint, net numeric, vat numeric, total numeric, credited numeric)
language sql stable security invoker
set search_path = public
as $$
  select public.require_clinic_role(array['manager'], 'Only managers can see income and VAT reports');
  with c as (select * from public.report_bounds(p_from, p_to)),
  s as (
    select ii.service_id, ii.quantity as qty, ii.line_total - ii.bill_discount_share as total, ii.vat_amount as vat, 0::numeric as credited
    from invoices i join c on i.clinic_id = c.clinic_id and i.created_at >= c.t0 and i.created_at < c.t1
    join invoice_items ii on ii.invoice_id = i.id
    where p_branch is null or i.branch_id = p_branch
    union all
    select x.service_id, 0, -x.amount, -x.vat, x.amount from public.report_credit_lines(p_from, p_to, p_branch) x
  )
  select s.service_id, sv.name, sum(s.qty), sum(s.total - s.vat), sum(s.vat), sum(s.total), sum(s.credited)
  from s left join services sv on sv.id = s.service_id
  group by s.service_id, sv.name
  order by sum(s.total) desc, sv.name;
$$;

create or replace function public.report_income_branches(p_from date, p_to date, p_branch uuid default null)
returns table (branch_id uuid, invoiced numeric, credited numeric, net numeric, collected numeric)
language sql stable security invoker
set search_path = public
as $$
  select public.require_clinic_role(array['manager'], 'Only managers can see income and VAT reports');
  with c as (select * from public.report_bounds(p_from, p_to)),
  m as (
    select i.branch_id, i.amount_total as inv, 0::numeric as cr, 0::numeric as col
    from invoices i join c on i.clinic_id = c.clinic_id and i.created_at >= c.t0 and i.created_at < c.t1
    union all
    select n.branch_id, 0, n.amount, -n.refund_amount
    from credit_notes n join c on n.clinic_id = c.clinic_id and n.created_at >= c.t0 and n.created_at < c.t1
    union all
    select p.branch_id, 0, 0, p.amount
    from invoice_payments p join c on p.clinic_id = c.clinic_id and p.paid_at >= c.t0 and p.paid_at < c.t1
  )
  select m.branch_id, sum(m.inv), sum(m.cr), sum(m.inv - m.cr), sum(m.col)
  from m where p_branch is null or m.branch_id = p_branch
  group by m.branch_id
  order by m.branch_id;
$$;

create or replace function public.report_vat_summary(p_from date, p_to date, p_branch uuid default null)
returns table (vat_rate numeric, sales_net numeric, sales_vat numeric, discounts numeric, credit_net numeric, credit_vat numeric, net_taxable numeric, net_vat numeric)
language sql stable security invoker
set search_path = public
as $$
  select public.require_clinic_role(array['manager'], 'Only managers can see income and VAT reports');
  with c as (select * from public.report_bounds(p_from, p_to)),
  x as (
    select ii.vat_rate, ii.line_total - ii.bill_discount_share - ii.vat_amount as sn, ii.vat_amount as sv,
           ii.discount_amount + ii.bill_discount_share as d, 0::numeric as cn, 0::numeric as cv
    from invoices i join c on i.clinic_id = c.clinic_id and i.created_at >= c.t0 and i.created_at < c.t1
    join invoice_items ii on ii.invoice_id = i.id
    where p_branch is null or i.branch_id = p_branch
    union all
    select r.vat_rate, 0, 0, 0, -(r.amount - r.vat), -r.vat from public.report_credit_lines(p_from, p_to, p_branch) r
  )
  select x.vat_rate, sum(x.sn), sum(x.sv), sum(x.d), sum(x.cn), sum(x.cv), sum(x.sn + x.cn), sum(x.sv + x.cv)
  from x group by x.vat_rate order by x.vat_rate desc;
$$;

notify pgrst, 'reload schema';
