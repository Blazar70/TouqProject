-- Rollback for 0076_branch_and_clinic_roles.sql. No data changes. Restores the 0073 time-off
-- and 0061 clinic-row bodies. Deploy the old clinic-manage-staff first (it calls replace_staff_branches).
drop trigger appointments_z_branch_write on appointments;
drop trigger medical_records_z_branch_write on medical_records;
drop trigger invoices_z_branch_write on invoices;
drop trigger invoice_payments_z_branch_write on invoice_payments;
drop trigger owner_balance_entries_z_branch_write on owner_balance_entries;
drop trigger cash_counts_z_branch_write on cash_counts;
drop function public.enforce_branch_write();

drop trigger pets_enforce_owner_move_role on pets;
drop trigger owner_files_enforce_merge_role on owner_files;
drop function public.enforce_owner_move_role();

drop function public.replace_staff_branches(uuid, uuid[]);

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

  update appointments set doctor_id = null
  where doctor_id = v_doctor
    and status in ('requested', 'confirmed', 'arrived')
    and scheduled_at >= p_starts and scheduled_at < p_ends;
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

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

notify pgrst, 'reload schema';
