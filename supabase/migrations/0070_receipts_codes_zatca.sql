-- 0070: deposit receipt numbers, invoice-code changes in the activity log,
-- ZATCA phase-2 columns reserved (user, 2026-10-23).

-- ---------------------------------------------------------------- deposit receipts
-- Balance top-ups get DEP-<branch invoice code>-000001, a running series per branch
-- (same counter table as invoices and credit notes). Without a branch: the main branch.
alter table invoice_counters drop constraint invoice_counters_kind_check;
alter table invoice_counters add constraint invoice_counters_kind_check check (kind in ('invoice', 'credit_note', 'deposit'));

alter table owner_balance_entries add column receipt_number text;

create function public.assign_receipt_number()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_branch uuid := coalesce(new.branch_id, (select id from branches where clinic_id = new.clinic_id and is_main));
  v_n integer;
begin
  if new.kind <> 'top_up' or v_branch is null then
    return new;
  end if;
  insert into invoice_counters as c (branch_id, kind, last_value)
  values (v_branch, 'deposit', 1)
  on conflict (branch_id, kind) do update set last_value = c.last_value + 1
  returning last_value into v_n;
  select 'DEP-' || invoice_code || '-' || lpad(v_n::text, greatest(6, length(v_n::text)), '0')
    into new.receipt_number from branches where id = v_branch;
  return new;
end;
$$;

create trigger owner_balance_entries_receipt_number
  before insert on owner_balance_entries
  for each row execute function public.assign_receipt_number();

-- Existing top-ups, oldest first per branch, then the counters continue from there.
with numbered as (
  select e.id, b.id as branch_id, b.invoice_code,
         row_number() over (partition by b.id order by e.created_at, e.id) as n
  from owner_balance_entries e
  join branches b on b.id = coalesce(e.branch_id, (select m.id from branches m where m.clinic_id = e.clinic_id and m.is_main))
  where e.kind = 'top_up'
)
update owner_balance_entries e
  set receipt_number = 'DEP-' || numbered.invoice_code || '-' || lpad(numbered.n::text, 6, '0')
  from numbered where numbered.id = e.id;

insert into invoice_counters (branch_id, kind, last_value)
select b.id, 'deposit', count(*)
from owner_balance_entries e
join branches b on b.id = coalesce(e.branch_id, (select m.id from branches m where m.clinic_id = e.clinic_id and m.is_main))
where e.kind = 'top_up'
group by b.id;

-- ---------------------------------------------------------------- invoice code log
-- 0057's branch log plus invoice-code changes (the old code -> the new one in the label).
create or replace function public.log_branch_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_action text;
  v_label text := new.name;
begin
  if auth.uid() is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'branch_added';
  elsif new.is_main and not old.is_main then
    v_action := 'branch_made_main';
  elsif old.active and not new.active then
    v_action := 'branch_closed';
  elsif new.active and not old.active then
    v_action := 'branch_reopened';
  elsif new.invoice_code is distinct from old.invoice_code then
    v_action := 'branch_invoice_code_changed';
    v_label := new.name || ' (' || old.invoice_code || ' → ' || new.invoice_code || ')';
  elsif (new.name, new.name_ar, new.phone, new.address) is distinct from (old.name, old.name_ar, old.phone, old.address) then
    v_action := 'branch_updated';
  else
    -- e.g. the old main branch losing is_main during make-main: logged once, on the new main.
    return null;
  end if;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), v_action, 'branch', v_label, new.clinic_id
  from (select 1) one
  left join profiles p on p.id = auth.uid();

  return null;
end;
$$;

-- ---------------------------------------------------------------- ZATCA phase 2
-- Reserved, empty until e-invoicing integration (Fatoora): invoice UUID, invoice
-- counter value (ICV) and the previous invoice's hash for the chain.
alter table invoices
  add column zatca_uuid uuid,
  add column zatca_icv bigint,
  add column zatca_previous_hash text;

notify pgrst, 'reload schema';
