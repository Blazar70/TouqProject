-- Rollback for 0073. LOSES the recount history: only the latest count per branch and day stays.
grant execute on function public.default_invoice_code(uuid, text) to public, anon, authenticated;

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
    and status in ('requested', 'confirmed')
    and scheduled_at >= p_starts and scheduled_at < p_ends;
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

delete from cash_counts c using cash_counts newer
where newer.branch_id = c.branch_id and newer.day = c.day
  and (newer.counted_at, newer.id) > (c.counted_at, c.id);
drop index if exists cash_counts_branch_day_idx;
alter table cash_counts add constraint cash_counts_branch_id_day_key unique (branch_id, day);
grant update on cash_counts to anon, authenticated;

notify pgrst, 'reload schema';
