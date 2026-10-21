-- Touq / طوق — invoice numbers per branch (decided 2026-10-22).
-- Each branch has an invoice code (2–6 of A-Z/0-9, e.g. EAST). Each invoice
-- gets CODE-000001, CODE-000002, ... per branch, from a counter row bumped
-- under a row lock (like pet numbers, 0052), so numbers never clash and are
-- never handed out twice. The code is locked once the branch has numbered
-- anything, so printed numbers stay true. Credit notes (0061) use the same
-- counter table with kind 'credit_note' and the prefix CN-.

alter table branches add column invoice_code text;

-- Latin letters/digits of the name, up to 6; BR1, BR2, ... when the name has
-- fewer than 2 (e.g. an Arabic-only name); a digit suffix when taken.
-- Same rule as defaultInvoiceCode() in src/lib/invoiceMath.ts.
create function public.default_invoice_code(p_clinic uuid, p_name text)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_base text := left(regexp_replace(upper(coalesce(p_name, '')), '[^A-Z0-9]', '', 'g'), 6);
  v_code text;
  v_n int := 1;
begin
  if length(v_base) < 2 then
    v_base := 'BR';
    v_code := 'BR1';
  else
    v_code := v_base;
  end if;
  while exists (select 1 from branches where clinic_id = p_clinic and invoice_code = v_code) loop
    v_n := v_n + 1;
    v_code := left(v_base, 6 - length(v_n::text)) || v_n;
  end loop;
  return v_code;
end;
$$;

-- Existing branches, main first, one at a time so each sees the codes before it.
do $$
declare
  b record;
begin
  for b in select id, clinic_id, name from branches order by clinic_id, is_main desc, created_at, id loop
    update branches set invoice_code = public.default_invoice_code(b.clinic_id, b.name) where id = b.id;
  end loop;
end $$;

alter table branches alter column invoice_code set not null;
alter table branches add constraint branches_invoice_code_format check (invoice_code ~ '^[A-Z0-9]{2,6}$');
alter table branches add constraint branches_clinic_invoice_code_key unique (clinic_id, invoice_code);

-- One row per branch and kind; only the security definer functions touch it.
create table invoice_counters (
  branch_id uuid not null references branches (id) on delete cascade,
  kind text not null check (kind in ('invoice', 'credit_note')),
  last_value integer not null,
  primary key (branch_id, kind)
);
alter table invoice_counters enable row level security;
revoke all on invoice_counters from anon, authenticated;

-- Default on insert; refuse a code change once the branch has numbered anything.
create function public.branch_invoice_code_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.invoice_code is null then
      new.invoice_code := public.default_invoice_code(new.clinic_id, new.name);
    end if;
  elsif new.invoice_code is distinct from old.invoice_code
    and exists (select 1 from invoice_counters where branch_id = old.id) then
    raise exception 'The invoice code of a branch with invoices can''t change' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger branches_invoice_code_guard
  before insert or update on branches
  for each row execute function public.branch_invoice_code_guard();

-- Existing invoices: numbered per branch in created order.
alter table invoices add column invoice_number text;

update invoices i set invoice_number = b.invoice_code || '-' || lpad(n.rn::text, 6, '0')
from (
  select id, row_number() over (partition by branch_id order by created_at, id) as rn
  from invoices
) n, branches b
where n.id = i.id and b.id = i.branch_id;

insert into invoice_counters (branch_id, kind, last_value)
select branch_id, 'invoice', count(*) from invoices group by branch_id;

-- Placeholder only, the trigger always overwrites it; lets inserts omit the column.
alter table invoices alter column invoice_number set default '';
alter table invoices alter column invoice_number set not null;
alter table invoices add constraint invoices_clinic_invoice_number_key unique (clinic_id, invoice_number);

-- Any client-sent number is ignored. Fires after invoices_fill_default_branch
-- (triggers run in name order), so branch_id is set.
create function public.assign_document_number()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_kind text := case tg_table_name when 'invoices' then 'invoice' else 'credit_note' end;
  v_n integer;
  v_number text;
begin
  insert into invoice_counters as c (branch_id, kind, last_value)
  values (new.branch_id, v_kind, 1)
  on conflict (branch_id, kind) do update set last_value = c.last_value + 1
  returning last_value into v_n;

  select invoice_code || '-' || lpad(v_n::text, greatest(6, length(v_n::text)), '0')
    into v_number from branches where id = new.branch_id;

  if v_kind = 'invoice' then
    new.invoice_number := v_number;
  else
    new.credit_number := 'CN-' || v_number;
  end if;
  return new;
end;
$$;

create trigger invoices_set_number
  before insert on invoices
  for each row execute function public.assign_document_number();
