-- Touq / طوق — reports (decided 2026-10-22): daily cash-up, unpaid bills,
-- income per service / per branch, VAT summary.
--
-- * Read-only, security invoker: RLS keeps every report inside the caller's
--   clinic, and each function also filters on current_user_clinic_id(), so an
--   admin (no clinic) gets nothing.
-- * Days are the clinic's days (clinics.timezone, Asia/Riyadh), not UTC or the
--   device clock: p_from..p_to are local dates, both included.
-- * Amounts are summed from what invoicing stored (2 decimals, VAT-inclusive
--   line totals, VAT already taken out per line), so nothing is re-rounded.
-- * Income and VAT are by document date (accrual): invoices by invoice date,
--   credit notes by their own date. The cash-up is by payment / refund date.
-- * p_branch null = every branch.

-- The clinic and the [t0, t1) instants of its local days p_from..p_to.
create function public.report_bounds(p_from date, p_to date)
returns table (clinic_id uuid, t0 timestamptz, t1 timestamptz, main_branch uuid)
language sql stable security invoker
set search_path = public
as $$
  select c.id, p_from::timestamp at time zone c.timezone, (p_to + 1)::timestamp at time zone c.timezone,
         (select b.id from branches b where b.clinic_id = c.id and b.is_main)
  from clinics c where c.id = public.current_user_clinic_id();
$$;

-- ---------------------------------------------------------------- cash-up
-- One day, per branch and method: payments on bills, owner deposits, refunds
-- paid out, net (= what the drawer / card terminal should show), and how many
-- payments and deposits. Method 'balance' = paid from / refunded to an
-- owner's balance: not drawer money, shown apart by the page.
-- Deposits saved without a branch count at the main branch (as fill_default_branch).
create function public.report_cash_up(p_day date, p_branch uuid default null)
returns table (branch_id uuid, method text, payments numeric, deposits numeric, refunds numeric, net numeric, entries integer)
language sql stable security invoker
set search_path = public
as $$
  with c as (select * from public.report_bounds(p_day, p_day)),
  m as (
    select p.branch_id, p.method, p.amount as payments, 0::numeric as deposits, 0::numeric as refunds, 1 as n
    from invoice_payments p join c on p.clinic_id = c.clinic_id and p.paid_at >= c.t0 and p.paid_at < c.t1
    union all
    select coalesce(e.branch_id, c.main_branch), e.method, 0, e.amount, 0, 1
    from owner_balance_entries e join c on e.clinic_id = c.clinic_id and e.created_at >= c.t0 and e.created_at < c.t1
    where e.kind = 'top_up'
    union all
    select n.branch_id, n.refund_method, 0, 0, n.refund_amount, 0
    from credit_notes n join c on n.clinic_id = c.clinic_id and n.created_at >= c.t0 and n.created_at < c.t1
    where n.refund_amount > 0
  )
  select m.branch_id, m.method, sum(m.payments), sum(m.deposits), sum(m.refunds),
         sum(m.payments + m.deposits - m.refunds), sum(m.n)::integer
  from m where p_branch is null or m.branch_id = p_branch
  group by m.branch_id, m.method
  order by m.branch_id, m.method;
$$;

-- ---------------------------------------------------------------- unpaid
-- Completed visits with no invoice (kind 'visit', total = their services at
-- list price incl. VAT, rounded like create_invoice) and invoices not fully
-- paid (kind 'invoice', after credit notes and refunds). Oldest first.
-- p_from / p_to (visit or invoice date) are optional.
create function public.report_unpaid(p_branch uuid default null, p_from date default null, p_to date default null)
returns table (kind text, id uuid, at timestamptz, branch_id uuid, invoice_number text, pet_name text, pet_number integer,
               owner_name text, owner_phone text, doctor_name text, total numeric, paid numeric, remaining numeric)
language sql stable security invoker
set search_path = public
as $$
  with c as (select * from public.report_bounds(coalesce(p_from, '1900-01-01'), coalesce(p_to, '2999-12-31'))),
  r as (
    select 'visit' as kind, a.id, a.scheduled_at as at, a.branch_id, null::text as invoice_number, a.pet_id, a.doctor_id,
           coalesce(s.total, 0) as total, 0::numeric as paid
    from appointments a join c on a.clinic_id = c.clinic_id and a.scheduled_at >= c.t0 and a.scheduled_at < c.t1
    left join lateral (
      select sum(round(round(x.unit_price * (1 + x.vat_rate / 100), 2) * x.quantity, 2)) as total
      from appointment_services x where x.appointment_id = a.id
    ) s on true
    where a.status = 'completed' and not exists (select 1 from invoices i where i.appointment_id = a.id)
    union all
    select 'invoice', i.id, i.created_at, i.branch_id, i.invoice_number, i.pet_id, a.doctor_id,
           i.amount_total - i.amount_credited, i.amount_paid - i.amount_refunded
    from invoices i join c on i.clinic_id = c.clinic_id and i.created_at >= c.t0 and i.created_at < c.t1
    left join appointments a on a.id = i.appointment_id
    where i.payment_status <> 'paid'
  )
  select r.kind, r.id, r.at, r.branch_id, r.invoice_number, p.name, p.pet_number, p.owner_name, p.owner_phone, d.full_name,
         r.total, r.paid, r.total - r.paid
  from r join pets p on p.id = r.pet_id
  left join profiles d on d.id = r.doctor_id
  where p_branch is null or r.branch_id = p_branch
  order by r.at, r.kind;
$$;

-- ---------------------------------------------------------------- credit notes per line
-- Credit notes dated p_from..p_to spread over the invoice lines they credit
-- (their item_ids, or every line for an amount-only note): the amount by line
-- total, the VAT by line VAT (so zero-rated lines get none). Rounding rest on
-- the biggest line, so each note's parts add up to it exactly.
-- shortcut: an amount-only note after an earlier line credit still spreads over every line; fine while credits are rare, upgrade by storing credited amounts per line.
create function public.report_credit_lines(p_from date, p_to date, p_branch uuid default null)
returns table (credit_note_id uuid, branch_id uuid, service_id uuid, vat_rate numeric, amount numeric, vat numeric)
language sql stable security invoker
set search_path = public
as $$
  with c as (select * from public.report_bounds(p_from, p_to)),
  l as (
    select n.id, n.branch_id, n.amount as n_amount, n.vat_amount as n_vat, ii.service_id, ii.vat_rate, ii.position,
           ii.line_total - ii.bill_discount_share as w, ii.vat_amount as wv
    from credit_notes n join c on n.clinic_id = c.clinic_id and n.created_at >= c.t0 and n.created_at < c.t1
    join invoice_items ii on ii.invoice_id = n.invoice_id and (cardinality(n.item_ids) = 0 or ii.id = any (n.item_ids))
    where p_branch is null or n.branch_id = p_branch
  ),
  r as (
    select l.*,
           case when sum(l.w) over k = 0 then 0 else round(l.n_amount * l.w / sum(l.w) over k, 2) end as a,
           case when sum(l.wv) over k = 0 then 0 else round(l.n_vat * l.wv / sum(l.wv) over k, 2) end as v,
           row_number() over (k order by l.w desc, l.position) as ra,
           row_number() over (k order by l.wv desc, l.position) as rv
    from l window k as (partition by l.id)
  )
  select r.id, r.branch_id, r.service_id, r.vat_rate,
         r.a + case when r.ra = 1 then r.n_amount - sum(r.a) over (partition by r.id) else 0 end,
         r.v + case when r.rv = 1 then r.n_vat - sum(r.v) over (partition by r.id) else 0 end
  from r;
$$;

-- ---------------------------------------------------------------- income
-- Per service (service_id null = custom lines, "Other"): quantity sold, and
-- net excl. VAT / VAT / total incl. VAT after discounts minus credit notes.
create function public.report_income_services(p_from date, p_to date, p_branch uuid default null)
returns table (service_id uuid, service_name text, quantity bigint, net numeric, vat numeric, total numeric, credited numeric)
language sql stable security invoker
set search_path = public
as $$
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

-- Per branch: invoiced (invoice date), credited (credit note date), net, and
-- collected = payments on bills (any method, balance included) minus refunds,
-- by payment / refund date. Owner deposits are not income until spent.
create function public.report_income_branches(p_from date, p_to date, p_branch uuid default null)
returns table (branch_id uuid, invoiced numeric, credited numeric, net numeric, collected numeric)
language sql stable security invoker
set search_path = public
as $$
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

-- ---------------------------------------------------------------- VAT
-- Per VAT rate: sales excl. VAT and their VAT (after discounts), discounts
-- given (incl. VAT, already off the sales), credit notes (negative), and the
-- net taxable amount and net VAT. An aid for the VAT return, not a filing.
create function public.report_vat_summary(p_from date, p_to date, p_branch uuid default null)
returns table (vat_rate numeric, sales_net numeric, sales_vat numeric, discounts numeric, credit_net numeric, credit_vat numeric,
               net_taxable numeric, net_vat numeric)
language sql stable security invoker
set search_path = public
as $$
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
