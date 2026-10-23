-- Rollback for 0070_receipts_codes_zatca.sql. Drops receipt numbers and the reserved
-- ZATCA columns (empty); the branch log goes back to the 0057 version.
alter table invoices drop column zatca_uuid, drop column zatca_icv, drop column zatca_previous_hash;
create or replace function public.log_branch_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_action text;
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
  elsif (new.name, new.name_ar, new.phone, new.address) is distinct from (old.name, old.name_ar, old.phone, old.address) then
    v_action := 'branch_updated';
  else
    -- e.g. the old main branch losing is_main during make-main: logged once, on the new main.
    return null;
  end if;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), v_action, 'branch', new.name, new.clinic_id
  from (select 1) one
  left join profiles p on p.id = auth.uid();

  return null;
end;
$$;

drop trigger if exists owner_balance_entries_receipt_number on owner_balance_entries;
drop function if exists public.assign_receipt_number();
alter table owner_balance_entries drop column receipt_number;
delete from invoice_counters where kind = 'deposit';
alter table invoice_counters drop constraint invoice_counters_kind_check;
alter table invoice_counters add constraint invoice_counters_kind_check check (kind in ('invoice', 'credit_note'));
notify pgrst, 'reload schema';
