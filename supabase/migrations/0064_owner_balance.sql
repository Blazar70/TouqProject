-- Touq / طوق — owner account balance (prepaid money) and owner merge (decided 2026-10-22).
--
-- * owner_files.balance is kept by a ledger, owner_balance_entries: top_up
--   (deposit), payment (paid an invoice from the balance), refund (credit note
--   refunded to the balance), adjustment (manager, with a reason). Every entry
--   moves the balance under a row lock; it can never go below 0 (checked here
--   and by a check constraint).
-- * Top-ups: receptionists and managers only, cash / card / apple_pay. Logged.
-- * 'balance' joins the invoice payment methods and credit-note refund methods.
--   A balance payment inserted by create_invoice() / add_invoice_payment()
--   takes the money from the invoice's pet's owner in the same transaction, so
--   too little balance fails the whole call. Those functions are unchanged.
-- * merge_owner_files(): pets, ledger and balance move to the kept owner; the
--   other file is deleted. Logged.
-- * Clients write nothing here directly.

alter table owner_files add column balance numeric(10, 2) not null default 0 check (balance >= 0);

create table owner_balance_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  owner_file_id uuid not null,
  kind text not null check (kind in ('top_up', 'payment', 'refund', 'adjustment')),
  amount numeric(10, 2) not null check (amount <> 0),
  method text check (method in ('cash', 'card', 'apple_pay')),
  reason text,
  invoice_id uuid references invoices (id) on delete set null,
  invoice_payment_id uuid references invoice_payments (id) on delete set null,
  credit_note_id uuid references credit_notes (id) on delete set null,
  branch_id uuid references branches (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (owner_file_id, clinic_id) references owner_files (id, clinic_id) on delete cascade,
  check ((kind = 'top_up') = (method is not null)),
  check (kind <> 'adjustment' or btrim(coalesce(reason, '')) <> ''),
  check (case kind when 'payment' then amount < 0 when 'adjustment' then true else amount > 0 end)
);
create index owner_balance_entries_owner_idx on owner_balance_entries (owner_file_id, created_at desc);

alter table owner_balance_entries enable row level security;
revoke insert, update, delete on owner_balance_entries from anon, authenticated;
create policy "owner_balance_entries_select_vet" on owner_balance_entries
  for select using (clinic_id = (select current_user_clinic_id()));
create policy "owner_balance_entries_select_admin" on owner_balance_entries
  for select using (current_user_is_admin());

-- Every entry moves the balance; never below 0.
create function public.apply_owner_balance_entry()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  select balance into v_balance from owner_files
  where id = new.owner_file_id and clinic_id = new.clinic_id for update;
  if not found then
    raise exception 'Owner not found' using errcode = 'P0001';
  end if;
  if v_balance + new.amount < 0 then
    raise exception 'Not enough balance (available %)', to_char(v_balance, 'FM999999990.00') using errcode = 'P0001';
  end if;
  update owner_files set balance = balance + new.amount where id = new.owner_file_id;
  return new;
end;
$$;

create trigger owner_balance_entries_apply
  before insert on owner_balance_entries
  for each row execute function public.apply_owner_balance_entry();

-- ---------------------------------------------------------------- methods
alter table invoice_payments drop constraint invoice_payments_method_check;
alter table invoice_payments add constraint invoice_payments_method_check check (method in ('cash', 'card', 'apple_pay', 'balance'));
alter table credit_notes drop constraint credit_notes_refund_method_check;
alter table credit_notes add constraint credit_notes_refund_method_check check (refund_method in ('cash', 'card', 'apple_pay', 'balance'));

-- A balance payment / refund moves the invoice's pet's owner's balance.
create function public.invoice_money_to_balance()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_table_name = 'invoice_payments' then
    insert into owner_balance_entries (clinic_id, owner_file_id, kind, amount, invoice_id, invoice_payment_id, branch_id, created_by)
    select i.clinic_id, p.owner_file_id, 'payment', -new.amount, i.id, new.id, new.branch_id, new.received_by
    from invoices i join pets p on p.id = i.pet_id where i.id = new.invoice_id;
  else
    insert into owner_balance_entries (clinic_id, owner_file_id, kind, amount, invoice_id, credit_note_id, branch_id, created_by)
    select i.clinic_id, p.owner_file_id, 'refund', new.refund_amount, i.id, new.id, new.branch_id, new.created_by
    from invoices i join pets p on p.id = i.pet_id where i.id = new.invoice_id;
  end if;
  return null;
end;
$$;

create trigger invoice_payments_from_balance
  after insert on invoice_payments
  for each row when (new.method = 'balance')
  execute function public.invoice_money_to_balance();
create trigger credit_notes_to_balance
  after insert on credit_notes
  for each row when (new.refund_method = 'balance' and new.refund_amount > 0)
  execute function public.invoice_money_to_balance();

-- ---------------------------------------------------------------- top up / adjust
-- One function for both: p_method set = top-up (receptionist or manager),
-- p_method null = adjustment (manager, reason required, may be negative).
-- Returns the new entry id. Logged.
create function public.add_owner_balance(p_owner uuid, p_amount numeric, p_method text, p_reason text default null, p_branch uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_owner owner_files;
  v_id uuid;
  v_kind text := case when p_method is null then 'adjustment' else 'top_up' end;
begin
  if not public.current_user_has_role(case when v_kind = 'top_up' then array['manager', 'receptionist'] else array['manager'] end) then
    raise exception 'Only receptionists and managers can add balance' using errcode = '42501';
  end if;
  select * into v_owner from owner_files where id = p_owner and clinic_id = public.current_user_clinic_id();
  if not found then
    raise exception 'Owner not found' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount = 0 or (v_kind = 'top_up' and (p_amount < 0 or p_method not in ('cash', 'card', 'apple_pay'))) then
    raise exception 'Enter an amount' using errcode = 'P0001';
  end if;
  if v_kind = 'adjustment' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'An adjustment needs a reason' using errcode = 'P0001';
  end if;
  if p_branch is not null and not exists (select 1 from branches where id = p_branch and clinic_id = v_owner.clinic_id) then
    raise exception 'Pick a branch of this clinic' using errcode = 'P0001';
  end if;

  insert into owner_balance_entries (clinic_id, owner_file_id, kind, amount, method, reason, branch_id, created_by)
  values (v_owner.clinic_id, p_owner, v_kind, round(p_amount, 2), p_method, nullif(btrim(p_reason), ''), p_branch, auth.uid())
  returning id into v_id;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), case when v_kind = 'top_up' then 'balance_top_up' else 'balance_adjusted' end,
         'owner', v_owner.name || ' · ' || round(p_amount, 2) || ' · ' || coalesce(p_method, btrim(p_reason)), v_owner.clinic_id
  from (select 1) one left join profiles p on p.id = auth.uid();
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- merge
-- p_remove's pets, ledger and balance move to p_keep; p_remove is deleted.
-- Kept owner's contact wins; an empty phone/email is filled; notes are joined.
create function public.merge_owner_files(p_keep uuid, p_remove uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_clinic uuid := public.current_user_clinic_id();
  v_keep owner_files;
  v_remove owner_files;
begin
  if v_clinic is null then
    raise exception 'Only clinic staff can merge owners' using errcode = '42501';
  end if;
  -- Lock both in id order so two merges can't deadlock.
  perform 1 from owner_files where id in (p_keep, p_remove) and clinic_id = v_clinic order by id for update;
  select * into v_keep from owner_files where id = p_keep and clinic_id = v_clinic;
  select * into v_remove from owner_files where id = p_remove and clinic_id = v_clinic;
  if v_keep.id is null or v_remove.id is null or p_keep = p_remove then
    raise exception 'Pick two different owners of this clinic' using errcode = 'P0001';
  end if;

  update owner_files set
    phone = coalesce(nullif(btrim(phone), ''), v_remove.phone),
    email = coalesce(nullif(btrim(email), ''), v_remove.email),
    notes = nullif(concat_ws(E'\n', nullif(btrim(notes), ''), nullif(btrim(v_remove.notes), '')), ''),
    balance = balance + v_remove.balance
  where id = p_keep;
  update pets set owner_file_id = p_keep where owner_file_id = p_remove;
  update owner_balance_entries set owner_file_id = p_keep where owner_file_id = p_remove;
  delete from owner_files where id = p_remove;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), 'owners_merged', 'owner',
         v_remove.name || ' → ' || v_keep.name || ' · ' || v_remove.balance, v_clinic
  from (select 1) one left join profiles p on p.id = auth.uid();
end;
$$;
