-- 0076: the remaining role rules (phase 4 part 3, user 2026-10-24).
-- * Branch writes: staff read the whole clinic but write only at branches they work at
--   (current_user_branch_ids(): staff_branches rows; a whole-clinic manager gets every open
--   branch). Checked on appointments and visit records (insert, edit, delete; a move must
--   start and end at your branches) and on new invoices, payments, owner balance entries
--   and cash counts. Credit notes take their invoice's branch, so they are not checked.
-- * Clinic name/phone (logo already, 0053): managers only. VAT number and staff discount
--   cap: whole-clinic managers only.
-- * Merging owners and moving a pet to another owner: receptionists and managers only.
-- * replace_staff_branches(): the staff edge function swaps a member's branches in one
--   transaction (a failed insert used to leave a branch manager with none = whole clinic).
-- Admins and server-side code (no auth.uid()) skip every rule here.

-- ---------------------------------------------------------------- branch writes
create function public.enforce_branch_write()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  -- pg_trigger_depth() > 1: written by another trigger (balance mirror of a payment, cascade
  -- of a pet delete), which follows the row that was checked. touq.branch_write_free: set by
  -- save_doctor_time_off, whose unassigning follows the manager's own rule (0058).
  if auth.uid() is null or public.current_user_is_admin() or public.current_user_clinic_role() is null
    or public.current_user_is_clinic_manager() or pg_trigger_depth() > 1
    or current_setting('touq.branch_write_free', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then
    v_old := old.branch_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new := new.branch_id;
  end if;
  if (v_old is not null and v_old not in (select public.current_user_branch_ids()))
    or (v_new is not null and v_new is distinct from v_old and v_new not in (select public.current_user_branch_ids())) then
    raise exception 'You can only make changes at a branch you work at' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

-- z_: after the other before-triggers, so fill_default_branch (0046) has set branch_id.
create trigger appointments_z_branch_write
  before insert or update or delete on appointments
  for each row execute function public.enforce_branch_write();
create trigger medical_records_z_branch_write
  before insert or update or delete on medical_records
  for each row execute function public.enforce_branch_write();
-- Only security-definer functions write these (create_invoice, add_invoice_payment,
-- add_owner_balance) or insert-only RLS (cash counts): insert is the only write to check.
create trigger invoices_z_branch_write
  before insert on invoices
  for each row execute function public.enforce_branch_write();
create trigger invoice_payments_z_branch_write
  before insert on invoice_payments
  for each row execute function public.enforce_branch_write();
create trigger owner_balance_entries_z_branch_write
  before insert on owner_balance_entries
  for each row execute function public.enforce_branch_write();
create trigger cash_counts_z_branch_write
  before insert on cash_counts
  for each row execute function public.enforce_branch_write();

-- Body as 0073, the unassigning wrapped in touq.branch_write_free: the doctor's appointments
-- at branches this manager doesn't run still lose their doctor.
create or replace function public.save_doctor_time_off(
  p_id uuid, p_doctor uuid, p_starts timestamptz, p_ends timestamptz, p_reason text)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_doctor uuid;
  v_moved integer;
begin
  if p_id is null then
    v_doctor := p_doctor;
  else
    select doctor_id into v_doctor from doctor_time_off where id = p_id;
  end if;
  if v_doctor is null or not public.can_manage_doctor_time_off(v_doctor) then
    raise exception 'only a manager of this doctor may change their time off';
  end if;

  if p_id is null then
    insert into doctor_time_off (clinic_id, doctor_id, starts_at, ends_at, reason, created_by)
    select clinic_id, id, p_starts, p_ends, p_reason, auth.uid() from profiles where id = v_doctor;
  else
    update doctor_time_off set starts_at = p_starts, ends_at = p_ends, reason = p_reason where id = p_id;
  end if;

  perform set_config('touq.branch_write_free', 'on', true);
  update appointments set doctor_id = null
  where doctor_id = v_doctor
    and status in ('requested', 'confirmed', 'arrived')
    and scheduled_at >= p_starts and scheduled_at < p_ends;
  get diagnostics v_moved = row_count;
  perform set_config('touq.branch_write_free', 'off', true);
  return v_moved;
end;
$$;

-- ---------------------------------------------------------------- clinic info
-- 0061's whitelist, narrowed: name/phone/logo for managers, VAT/cap for whole-clinic managers.
-- Logo changes are still logged by clinics_log_logo_change (0057).
create or replace function public.enforce_clinic_row_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_open text[] := array['name', 'phone', 'logo_url', 'vat_number', 'max_staff_discount_percent'];
begin
  if auth.role() is not distinct from 'service_role' or auth.uid() is null or public.current_user_is_admin() then
    return new;
  end if;
  if (to_jsonb(new) - v_open) is distinct from (to_jsonb(old) - v_open) then
    raise exception 'only an admin may change this clinic setting';
  end if;
  if (new.name, new.phone, new.logo_url) is distinct from (old.name, old.phone, old.logo_url)
    and not public.current_user_has_role(array['manager']) then
    raise exception 'Only managers can change the clinic info' using errcode = 'P0001';
  end if;
  if (new.vat_number, new.max_staff_discount_percent) is distinct from (old.vat_number, old.max_staff_discount_percent)
    and not public.current_user_is_clinic_manager() then
    raise exception 'Only a whole-clinic manager can change the VAT number or discount limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- owner merge / pet move
-- Moving a pet (pets.owner_file_id) and merging (merge_owner_files always deletes the merged
-- owner; nothing else deletes owner files). Editing pet or owner details stays open.
create function public.enforce_owner_move_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.require_clinic_role(array['receptionist', 'manager'], 'Only receptionists and managers can merge owners or move pets');
  return coalesce(new, old);
end;
$$;

create trigger pets_enforce_owner_move_role
  before update of owner_file_id on pets
  for each row when (old.owner_file_id is distinct from new.owner_file_id)
  execute function public.enforce_owner_move_role();
create trigger owner_files_enforce_merge_role
  before delete on owner_files
  for each row execute function public.enforce_owner_move_role();

-- ---------------------------------------------------------------- staff branches
-- One statement = one transaction: the delete never lands without the insert.
create function public.replace_staff_branches(p_profile uuid, p_branches uuid[])
returns void
language sql security definer
set search_path = public
as $$
  delete from staff_branches where profile_id = p_profile;
  insert into staff_branches (profile_id, branch_id) select p_profile, unnest(p_branches);
$$;
revoke execute on function public.replace_staff_branches(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.replace_staff_branches(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
