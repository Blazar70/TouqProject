-- Touq / طوق — doctor time off (decided 2026-10-22).
-- Managers enter a reason + start/end for a doctor. Whole-clinic managers
-- (0056) for any doctor of the clinic, branch managers for doctors who work at
-- one of their branches, admins for anyone.
-- * The reason is manager-only: the table itself is readable only by those who
--   may manage that doctor. Everyone else in the clinic reads the periods
--   (no reason) through doctor_time_off_periods().
-- * Writes go through save_doctor_time_off() (no insert/update policy), which
--   unassigns the doctor's requested/confirmed appointments inside the period
--   in the same transaction and returns how many. Delete is a plain delete;
--   shortening or deleting never reassigns anything back.
-- * Booking or moving an appointment onto a doctor who is away is refused.
-- * Created / updated / deleted is logged to admin_audit_log (0057 pattern).

create table doctor_time_off (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  doctor_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (doctor_id, clinic_id) references profiles (id, clinic_id) on delete cascade,
  check (ends_at > starts_at)
);

create index doctor_time_off_doctor_idx on doctor_time_off (doctor_id, starts_at);
create index doctor_time_off_clinic_idx on doctor_time_off (clinic_id, starts_at);

alter table doctor_time_off enable row level security;

create function public.can_manage_doctor_time_off(p_doctor uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.current_user_is_admin()
    or exists (
      select 1 from profiles d
      where d.id = p_doctor
        and d.clinic_id = public.current_user_clinic_id()
        and public.current_user_has_role(array['manager'])
        and (
          public.current_user_is_clinic_manager()
          or exists (
            select 1 from staff_branches sb
            where sb.profile_id = d.id and sb.branch_id in (select public.current_user_branch_ids())
          )
        )
    );
$$;

-- Reason included: only managers of that doctor (and admins) see these rows.
create policy "doctor_time_off_select_manager" on doctor_time_off
  for select using ((select public.can_manage_doctor_time_off(doctor_id)));

create policy "doctor_time_off_delete_manager" on doctor_time_off
  for delete using ((select public.can_manage_doctor_time_off(doctor_id)));

-- Everyone in the clinic: who is away when, without the reason.
create function public.doctor_time_off_periods(p_from timestamptz, p_to timestamptz)
returns table (id uuid, doctor_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select t.id, t.doctor_id, t.starts_at, t.ends_at
  from doctor_time_off t
  where t.clinic_id = public.current_user_clinic_id()
    and t.starts_at < p_to
    and t.ends_at > p_from
  order by t.starts_at;
$$;

-- p_id null = new entry for p_doctor; otherwise edits that entry (doctor can't change).
-- Returns how many appointments were moved to Unassigned.
create function public.save_doctor_time_off(
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

create function public.enforce_doctor_not_away()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.doctor_id is not null
    and (tg_op = 'INSERT' or new.doctor_id is distinct from old.doctor_id or new.scheduled_at is distinct from old.scheduled_at)
    and exists (
      select 1 from doctor_time_off t
      where t.doctor_id = new.doctor_id and new.scheduled_at >= t.starts_at and new.scheduled_at < t.ends_at
    )
  then
    raise exception 'This doctor is away (time off) at that time. Pick another doctor or time.';
  end if;
  return new;
end;
$$;

create trigger appointments_enforce_doctor_not_away
  before insert or update of doctor_id, scheduled_at on appointments
  for each row execute function public.enforce_doctor_not_away();

-- Logs actor, doctor and period (clinic time), never the reason.
create function public.log_doctor_time_off_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_row doctor_time_off;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(a.full_name, 'Unknown'),
    case tg_op when 'INSERT' then 'time_off_added' when 'UPDATE' then 'time_off_updated' else 'time_off_deleted' end,
    'staff',
    coalesce(d.full_name, 'Unknown') || ' · '
      || to_char(v_row.starts_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' – '
      || to_char(v_row.ends_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
    -- null when the whole clinic is being deleted (the cascade already removed it)
    (select c.id from clinics c where c.id = v_row.clinic_id)
  from (select 1) one
  left join profiles a on a.id = auth.uid()
  left join profiles d on d.id = v_row.doctor_id;
  return null;
end;
$$;

create trigger doctor_time_off_log_change
  after insert or update or delete on doctor_time_off
  for each row execute function public.log_doctor_time_off_change();
