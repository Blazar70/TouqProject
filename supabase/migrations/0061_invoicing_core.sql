-- Touq / طوق — invoicing core (decided 2026-10-22).
--
-- * Invoices are created in ONE call, create_invoice(): invoice, lines,
--   discounts and first payments, with every total computed here. Before, the
--   app wrote the invoice and its lines separately and the totals could differ.
-- * Prices stay VAT-inclusive (what the price list shows the customer). VAT is
--   taken out of the DISCOUNTED amount per line: vat = round(x * r / (100 + r), 2),
--   which is r% of the discounted net (ZATCA). A whole-bill discount is spread
--   over the lines by amount (rounding remainder on the biggest line).
-- * Discounts: percent or fixed amount, per line or whole bill, reason required.
--   Non-managers are held to clinics.max_staff_discount_percent (a fixed amount
--   counts as its percent of what it applies to). Every discount is logged.
-- * Payments: several parts per invoice (cash / card / apple_pay). The method is
--   a check constraint so adding 'balance' later is one small migration.
--   payment_status unpaid / partly_paid / paid is kept by the database.
-- * Credit notes: full or partial, reason required, numbered CN-CODE-000001 per
--   branch, never more than what is left on the invoice. Logged.
-- * Invoices can't be deleted or changed by clients; all writes go through the
--   security definer functions below. Pet / clinic purge still cascade.
-- * clinics.vat_number (Saudi 15 digits, 3...3) and max_staff_discount_percent,
--   editable by managers and admins only.
-- * The old single method + recorded/verified check (and paid_at) move to
--   invoice_payments; the "verify against the slip" step is gone.

-- ---------------------------------------------------------------- clinics
alter table clinics add column vat_number text check (vat_number ~ '^3[0-9]{13}3$');
alter table clinics add column max_staff_discount_percent numeric(5, 2) not null default 10
  check (max_staff_discount_percent >= 0 and max_staff_discount_percent <= 100);

-- 0054's whitelist, plus the two billing settings for managers only.
create or replace function public.enforce_clinic_row_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_allowed text[] := array['name', 'phone', 'logo_url']
    || case when public.current_user_has_role(array['manager']) then array['vat_number', 'max_staff_discount_percent'] else '{}'::text[] end;
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is not null
    and not public.current_user_is_admin()
    and (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed)
  then
    raise exception 'only an admin or a manager may change this clinic setting';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- invoices
alter table invoices
  add column discount_type text check (discount_type in ('percent', 'amount')),
  add column discount_value numeric(10, 2),
  add column discount_amount numeric(10, 2) not null default 0,
  add column discount_reason text,
  add column vat_total numeric(10, 2) not null default 0,
  add column amount_paid numeric(10, 2) not null default 0,
  add column amount_credited numeric(10, 2) not null default 0,
  add column amount_refunded numeric(10, 2) not null default 0,
  add column payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partly_paid', 'paid'));

alter table invoice_items
  add column position integer not null default 0,
  add column vat_rate numeric(5, 2) not null default 15,
  add column discount_type text check (discount_type in ('percent', 'amount')),
  add column discount_value numeric(10, 2),
  add column discount_amount numeric(10, 2) not null default 0,
  add column discount_reason text,
  add column bill_discount_share numeric(10, 2) not null default 0,
  add column vat_amount numeric(10, 2) not null default 0;

create table invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  clinic_id uuid not null references clinics (id),
  branch_id uuid not null,
  method text not null constraint invoice_payments_method_check check (method in ('cash', 'card', 'apple_pay')),
  amount numeric(10, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  received_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, clinic_id) references branches (id, clinic_id)
);
create index invoice_payments_invoice_idx on invoice_payments (invoice_id);
create index invoice_payments_clinic_paid_at_idx on invoice_payments (clinic_id, paid_at desc);

create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  invoice_id uuid not null references invoices (id) on delete cascade,
  branch_id uuid not null,
  credit_number text not null default '', -- set by assign_document_number()
  item_ids uuid[] not null default '{}',
  amount numeric(10, 2) not null check (amount > 0),
  vat_amount numeric(10, 2) not null default 0,
  reason text not null check (btrim(reason) <> ''),
  refund_method text not null constraint credit_notes_refund_method_check check (refund_method in ('cash', 'card', 'apple_pay')),
  refund_amount numeric(10, 2) not null default 0,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, clinic_id) references branches (id, clinic_id),
  unique (clinic_id, credit_number)
);
create index credit_notes_invoice_idx on credit_notes (invoice_id);

create trigger credit_notes_set_number
  before insert on credit_notes
  for each row execute function public.assign_document_number();

-- Existing invoices: lines get their service's VAT rate (15 for custom lines),
-- VAT is taken out of each line, and the old method becomes one payment.
update invoice_items ii set
  vat_rate = coalesce(s.vat_rate, 15),
  position = n.rn
from invoice_items ii2
left join services s on s.id = ii2.service_id
join (select id, row_number() over (partition by invoice_id order by id) as rn from invoice_items) n on n.id = ii2.id
where ii.id = ii2.id;
update invoice_items set vat_amount = round(line_total * vat_rate / (100 + vat_rate), 2);

update invoices i set vat_total = coalesce(
  (select sum(vat_amount) from invoice_items where invoice_id = i.id),
  round(i.amount_total * 15 / 115, 2));

insert into invoice_payments (invoice_id, clinic_id, branch_id, method, amount, paid_at, received_by, created_at)
select id, clinic_id, branch_id, method, amount_total, paid_at, coalesce(verified_by, created_by), created_at
from invoices where amount_total > 0;

update invoices set amount_paid = amount_total, payment_status = 'paid';

drop index if exists invoices_clinic_paid_at_idx;
alter table invoices drop column method, drop column status, drop column verified_by, drop column verified_at, drop column paid_at;
create index invoices_clinic_created_at_idx on invoices (clinic_id, created_at desc);

-- ---------------------------------------------------------------- access
-- Clients read; every write goes through the functions below.
revoke insert, update, delete on invoices, invoice_items from anon, authenticated;

alter table invoice_payments enable row level security;
alter table credit_notes enable row level security;
revoke insert, update, delete on invoice_payments, credit_notes from anon, authenticated;

create policy "invoice_payments_select_vet" on invoice_payments
  for select using (clinic_id = (select current_user_clinic_id()));
create policy "invoice_payments_select_admin" on invoice_payments
  for select using (current_user_is_admin());
create policy "credit_notes_select_vet" on credit_notes
  for select using (clinic_id = (select current_user_clinic_id()));
create policy "credit_notes_select_admin" on credit_notes
  for select using (current_user_is_admin());

-- ---------------------------------------------------------------- helpers
-- Discount amount for one discount on p_base (VAT-inclusive). p_discount is
-- null or {type: percent|amount, value, reason}. p_max null = no limit.
create function public.invoice_discount(p_base numeric, p_discount jsonb, p_max numeric)
returns numeric
language plpgsql immutable
set search_path = public
as $$
declare
  v_type text := p_discount->>'type';
  v_value numeric := (p_discount->>'value')::numeric;
  v_amount numeric;
begin
  if p_discount is null or jsonb_typeof(p_discount) = 'null' then
    return 0;
  end if;
  if coalesce(btrim(p_discount->>'reason'), '') = '' then
    raise exception 'A discount needs a reason' using errcode = 'P0001';
  end if;
  if v_type = 'percent' and v_value > 0 and v_value <= 100 then
    v_amount := round(p_base * v_value / 100, 2);
  elsif v_type = 'amount' and v_value > 0 and v_value <= p_base then
    v_amount := round(v_value, 2);
  else
    raise exception 'Enter a discount between 0 and the amount it applies to' using errcode = 'P0001';
  end if;
  -- A fixed amount counts as its percent of what it applies to.
  if p_max is not null and (case when v_type = 'percent' then v_value else v_amount * 100 / nullif(p_base, 0) end) > p_max then
    raise exception 'Discount over the staff limit of %', trim(to_char(p_max, 'FM990.##'), '.') || '%' using errcode = 'P0001';
  end if;
  return v_amount;
end;
$$;

-- Paid / credited / status, from the payments and credit notes.
create function public.refresh_invoice_status(p_invoice uuid)
returns void
language sql security definer
set search_path = public
as $$
  update invoices i set
    amount_paid = p.paid,
    amount_credited = c.credited,
    amount_refunded = c.refunded,
    payment_status = case
      when i.amount_total - c.credited - (p.paid - c.refunded) <= 0 then 'paid'
      when p.paid - c.refunded > 0 then 'partly_paid'
      else 'unpaid' end
  from
    (select coalesce(sum(amount), 0) as paid from invoice_payments where invoice_id = p_invoice) p,
    (select coalesce(sum(amount), 0) as credited, coalesce(sum(refund_amount), 0) as refunded from credit_notes where invoice_id = p_invoice) c
  where i.id = p_invoice;
$$;

-- ---------------------------------------------------------------- create
-- p_lines: [{service_id?, description, unit_price (incl. VAT), quantity, discount?}]
-- p_discount: whole-bill discount or null. p_payments: [{method, amount}].
-- Returns the new invoice id. A second invoice for one visit fails with 23505.
create function public.create_invoice(
  p_pet uuid,
  p_branch uuid,
  p_appointment uuid,
  p_notes text,
  p_lines jsonb,
  p_discount jsonb,
  p_payments jsonb,
  p_paid_at timestamptz default now()
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_clinic uuid := public.current_user_clinic_id();
  v_max numeric;
  v_line jsonb;
  v_pay jsonb;
  v_unit numeric;
  v_qty integer;
  v_rate numeric;
  v_gross numeric;
  v_disc numeric;
  v_n integer := 0;
  v_after numeric[] := '{}';
  v_line_disc numeric[] := '{}';
  v_rates numeric[] := '{}';
  v_share numeric[] := '{}';
  v_sum numeric := 0;
  v_bill numeric;
  v_big integer := 1;
  v_vat numeric;
  v_vat_total numeric := 0;
  v_paid numeric := 0;
  v_id uuid;
  v_branch uuid;
  i integer;
begin
  if v_clinic is null then
    raise exception 'Only clinic staff can create invoices' using errcode = '42501';
  end if;
  if not exists (select 1 from pets where id = p_pet and clinic_id = v_clinic) then
    raise exception 'Choose a pet' using errcode = 'P0001';
  end if;
  if p_appointment is not null and not exists (select 1 from appointments where id = p_appointment and clinic_id = v_clinic and pet_id = p_pet) then
    raise exception 'That appointment is not this pet''s' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then
    raise exception 'Add at least one item' using errcode = 'P0001';
  end if;

  -- Managers: any discount. Everyone else: up to the clinic's limit.
  select case when public.current_user_has_role(array['manager']) then null else max_staff_discount_percent end
    into v_max from clinics where id = v_clinic;

  -- Pass 1: each line after its own discount.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_unit := (v_line->>'unit_price')::numeric;
    v_qty := (v_line->>'quantity')::integer;
    if coalesce(btrim(v_line->>'description'), '') = '' or v_unit is null or v_unit < 0 or v_qty is null or v_qty <= 0 then
      raise exception 'Add at least one item with a valid price' using errcode = 'P0001';
    end if;
    v_rate := 15;
    if nullif(v_line->>'service_id', '') is not null then
      select vat_rate into v_rate from services where id = (v_line->>'service_id')::uuid and clinic_id = v_clinic;
      if not found then
        raise exception 'Pick a service from this clinic''s price list' using errcode = 'P0001';
      end if;
    end if;
    v_gross := round(v_unit * v_qty, 2);
    v_disc := public.invoice_discount(v_gross, v_line->'discount', v_max);
    v_n := v_n + 1;
    v_after := v_after || (v_gross - v_disc);
    v_line_disc := v_line_disc || v_disc;
    v_rates := v_rates || v_rate;
    v_sum := v_sum + v_gross - v_disc;
    if v_gross - v_disc > v_after[v_big] then v_big := v_n; end if;
  end loop;

  -- Whole-bill discount, spread over the lines by amount.
  v_bill := case when p_discount is null or jsonb_typeof(p_discount) = 'null' then 0
                 else public.invoice_discount(v_sum, p_discount, v_max) end;
  for i in 1..v_n loop
    v_share := v_share || case when v_sum = 0 then 0 else round(v_bill * v_after[i] / v_sum, 2) end;
  end loop;
  v_share[v_big] := v_share[v_big] + v_bill - (select coalesce(sum(s), 0) from unnest(v_share) s);

  for i in 1..v_n loop
    v_vat_total := v_vat_total + round((v_after[i] - v_share[i]) * v_rates[i] / (100 + v_rates[i]), 2);
  end loop;

  insert into invoices (clinic_id, pet_id, appointment_id, branch_id, created_by, notes, amount_total, vat_total,
                        discount_type, discount_value, discount_amount, discount_reason)
  values (v_clinic, p_pet, p_appointment, p_branch, auth.uid(), nullif(btrim(p_notes), ''), v_sum - v_bill, v_vat_total,
          case when v_bill > 0 then p_discount->>'type' end,
          case when v_bill > 0 then (p_discount->>'value')::numeric end,
          v_bill,
          case when v_bill > 0 then btrim(p_discount->>'reason') end)
  returning id, branch_id into v_id, v_branch;

  i := 0;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into invoice_items (invoice_id, position, service_id, description, unit_price, quantity, vat_rate,
                               discount_type, discount_value, discount_amount, discount_reason,
                               line_total, bill_discount_share, vat_amount)
    values (v_id, i, nullif(v_line->>'service_id', '')::uuid, btrim(v_line->>'description'),
            (v_line->>'unit_price')::numeric, (v_line->>'quantity')::integer, v_rates[i],
            case when v_line_disc[i] > 0 then v_line->'discount'->>'type' end,
            case when v_line_disc[i] > 0 then (v_line->'discount'->>'value')::numeric end,
            v_line_disc[i],
            case when v_line_disc[i] > 0 then btrim(v_line->'discount'->>'reason') end,
            v_after[i], v_share[i],
            round((v_after[i] - v_share[i]) * v_rates[i] / (100 + v_rates[i]), 2));
  end loop;

  for v_pay in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_paid := v_paid + (v_pay->>'amount')::numeric;
    insert into invoice_payments (invoice_id, clinic_id, branch_id, method, amount, paid_at, received_by)
    values (v_id, v_clinic, v_branch, v_pay->>'method', (v_pay->>'amount')::numeric, coalesce(p_paid_at, now()), auth.uid());
  end loop;
  if v_paid > v_sum - v_bill then
    raise exception 'The payments are more than the invoice total' using errcode = 'P0001';
  end if;

  perform public.refresh_invoice_status(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- pay
create function public.add_invoice_payment(p_invoice uuid, p_method text, p_amount numeric, p_branch uuid default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_inv invoices;
begin
  select * into v_inv from invoices where id = p_invoice and clinic_id = public.current_user_clinic_id() for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0
    or p_amount > v_inv.amount_total - v_inv.amount_credited - (v_inv.amount_paid - v_inv.amount_refunded) then
    raise exception 'Enter an amount up to what is still owed' using errcode = 'P0001';
  end if;
  insert into invoice_payments (invoice_id, clinic_id, branch_id, method, amount, received_by)
  values (p_invoice, v_inv.clinic_id, coalesce(p_branch, v_inv.branch_id), p_method, round(p_amount, 2), auth.uid());
  perform public.refresh_invoice_status(p_invoice);
end;
$$;

-- ---------------------------------------------------------------- credit
-- Pick lines (p_item_ids) and/or an amount. Lines alone credit their total
-- after discounts; an amount alone takes VAT in proportion to what is left.
-- The credit first reduces what is still owed; the rest is refunded.
create function public.create_credit_note(p_invoice uuid, p_item_ids uuid[], p_amount numeric, p_reason text, p_refund_method text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_inv invoices;
  v_base numeric;
  v_base_vat numeric;
  v_amount numeric;
  v_owed numeric;
  v_id uuid;
begin
  select * into v_inv from invoices where id = p_invoice and clinic_id = public.current_user_clinic_id() for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A credit note needs a reason' using errcode = 'P0001';
  end if;

  if coalesce(cardinality(p_item_ids), 0) > 0 then
    if (select count(*) from invoice_items where invoice_id = p_invoice and id = any (p_item_ids)) <> cardinality(p_item_ids) then
      raise exception 'Pick lines from this invoice' using errcode = 'P0001';
    end if;
    if exists (select 1 from credit_notes where invoice_id = p_invoice and item_ids && p_item_ids) then
      raise exception 'One of these lines is already credited' using errcode = 'P0001';
    end if;
    select sum(line_total - bill_discount_share), sum(vat_amount) into v_base, v_base_vat
    from invoice_items where id = any (p_item_ids);
  else
    -- What is left, and the VAT still in it.
    v_base := v_inv.amount_total - v_inv.amount_credited;
    v_base_vat := v_inv.vat_total - coalesce((select sum(vat_amount) from credit_notes where invoice_id = p_invoice), 0);
  end if;

  v_amount := round(coalesce(p_amount, v_base), 2);
  if v_amount <= 0 or v_amount > v_base or v_amount > v_inv.amount_total - v_inv.amount_credited then
    raise exception 'A credit note can''t be more than what is left on the invoice' using errcode = 'P0001';
  end if;

  v_owed := greatest(v_inv.amount_total - v_inv.amount_credited - (v_inv.amount_paid - v_inv.amount_refunded), 0);
  insert into credit_notes (clinic_id, invoice_id, branch_id, item_ids, amount, vat_amount, reason, refund_method, refund_amount, created_by)
  values (v_inv.clinic_id, p_invoice, v_inv.branch_id, coalesce(p_item_ids, '{}'), v_amount,
          case when v_base = 0 then 0 else round(v_amount * v_base_vat / v_base, 2) end,
          btrim(p_reason), p_refund_method, greatest(v_amount - v_owed, 0), auth.uid())
  returning id into v_id;

  perform public.refresh_invoice_status(p_invoice);
  return v_id;
end;
$$;

-- Only the functions above call it.
revoke execute on function public.refresh_invoice_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- audit
-- Every discount and credit note, by whoever signed in (style of 0057).
create function public.log_invoice_money()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_inv invoices;
  v_label text;
  v_action text := 'discount_given';
begin
  if auth.uid() is null then
    return null;
  end if;
  -- Field names differ per table, so each branch reads only its own.
  if tg_table_name = 'invoices' then
    if new.discount_amount = 0 then return null; end if;
    v_inv := new;
    v_label := '';
  elsif tg_table_name = 'invoice_items' then
    if new.discount_amount = 0 then return null; end if;
    select * into v_inv from invoices where id = new.invoice_id;
    v_label := new.description || ' · ';
  else
    select * into v_inv from invoices where id = new.invoice_id;
    v_action := 'credit_note_issued';
    v_label := new.credit_number || ' · ' || v_inv.invoice_number || ' · ' || new.amount || ' · ' || new.reason;
  end if;
  if v_action = 'discount_given' then
    v_label := v_inv.invoice_number || ' · ' || v_label
      || case when new.discount_type = 'percent' then trim(to_char(new.discount_value, 'FM990.##'), '.') || '% = ' else '' end
      || new.discount_amount || ' · ' || new.discount_reason;
  end if;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), v_action, 'invoice', v_label, v_inv.clinic_id
  from (select 1) one
  left join profiles p on p.id = auth.uid();
  return null;
end;
$$;

create trigger invoices_log_discount after insert on invoices
  for each row execute function public.log_invoice_money();
create trigger invoice_items_log_discount after insert on invoice_items
  for each row execute function public.log_invoice_money();
create trigger credit_notes_log after insert on credit_notes
  for each row execute function public.log_invoice_money();
