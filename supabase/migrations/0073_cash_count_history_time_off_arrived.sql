-- 0073: nightly report 2026-10-24 fixes.
-- S8: every cash count is kept (a recount adds a row, it never overwrites), so a shortage
--     can't be counted away; the latest row per branch and day is the current count.
-- B8: doctor time off also moves "arrived" appointments (0072) to Unassigned.
-- 6a: default_invoice_code() is only for the 0060 branch trigger, which runs as the owner.

alter table cash_counts drop constraint cash_counts_branch_id_day_key;
create index cash_counts_branch_day_idx on cash_counts (branch_id, day, counted_at desc);
revoke update on cash_counts from anon, authenticated;

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

revoke execute on function public.default_invoice_code(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
