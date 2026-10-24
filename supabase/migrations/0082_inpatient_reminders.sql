-- Touq / طوق — phase 6, staff medication/check reminders on an inpatient stay (user choices 2026-10-24):
-- "every N hours from a start" (optional end), push to the doctors and nurses at the pet's branch
-- when a dose is due, "Done" logs who and when (internal, not in the owner's text). Doctors and
-- managers add and stop reminders; doctors, nurses and managers mark doses done. Reminders end at
-- discharge. Due times are never stored: inpatient_task_slots() works them out for the app and the
-- push job alike.

create table inpatient_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  stay_id uuid not null references inpatient_stays (id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  every_hours integer not null check (every_hours between 1 and 72),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  stopped_at timestamptz,
  stopped_by uuid references profiles (id) on delete set null,
  check (ends_at is null or ends_at > starts_at)
);
create index inpatient_tasks_stay on inpatient_tasks (stay_id);

create table inpatient_task_doses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  task_id uuid not null references inpatient_tasks (id) on delete cascade,
  due_at timestamptz not null,
  done_at timestamptz not null default now(),
  done_by uuid references profiles (id) on delete set null,
  unique (task_id, due_at)
);

-- Push job bookkeeping (service role only: RLS on, no policies).
create table inpatient_task_alerts_sent (
  task_id uuid not null references inpatient_tasks (id) on delete cascade,
  due_at timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (task_id, due_at)
);

alter table inpatient_tasks enable row level security;
alter table inpatient_task_doses enable row level security;
alter table inpatient_task_alerts_sent enable row level security;

create policy inpatient_tasks_all_admin on inpatient_tasks for all using (public.current_user_is_admin());
create policy inpatient_tasks_select_staff on inpatient_tasks for select
  using (clinic_id = (select public.current_user_clinic_id()));
create policy inpatient_tasks_insert_doctor on inpatient_tasks for insert
  with check (
    clinic_id = (select public.current_user_clinic_id())
    and (select public.current_user_has_role(array['doctor', 'manager']))
    and stopped_at is null
    and stay_id in (select id from inpatient_stays where clinic_id = (select public.current_user_clinic_id()) and discharged_at is null)
  );
create policy inpatient_tasks_update_doctor on inpatient_tasks for update
  using (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['doctor', 'manager'])))
  with check (clinic_id = (select public.current_user_clinic_id()));
-- Stopping is the only client edit.
revoke update on inpatient_tasks from authenticated;
grant update (stopped_at) on inpatient_tasks to authenticated;

create policy inpatient_task_doses_all_admin on inpatient_task_doses for all using (public.current_user_is_admin());
create policy inpatient_task_doses_select_staff on inpatient_task_doses for select
  using (clinic_id = (select public.current_user_clinic_id()));
create policy inpatient_task_doses_insert_clinician on inpatient_task_doses for insert
  with check (
    clinic_id = (select public.current_user_clinic_id())
    and (select public.current_user_has_role(array['doctor', 'nurse', 'manager']))
    and task_id in (select id from inpatient_tasks where clinic_id = (select public.current_user_clinic_id()))
  );
-- Undo a mis-tick: whoever ticked it, or a manager.
create policy inpatient_task_doses_delete_own on inpatient_task_doses for delete
  using (
    clinic_id = (select public.current_user_clinic_id())
    and (done_by = (select auth.uid()) or (select public.current_user_has_role(array['manager'])))
  );
revoke update on inpatient_task_doses from authenticated;

create function public.fill_inpatient_task()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  elsif new.stopped_at is not null and old.stopped_at is null then
    new.stopped_at := now();
    new.stopped_by := auth.uid();
  elsif old.stopped_at is not null and new.stopped_at is distinct from old.stopped_at then
    raise exception 'This reminder was already stopped' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger inpatient_tasks_fill before insert or update on inpatient_tasks
  for each row execute function public.fill_inpatient_task();

-- A dose must be one of the reminder's due times, already due (up to an hour early), and the
-- reminder still running.
create function public.fill_inpatient_task_dose()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  t inpatient_tasks;
  s inpatient_stays;
begin
  select * into t from inpatient_tasks where id = new.task_id;
  select * into s from inpatient_stays where id = t.stay_id;
  if new.due_at < t.starts_at
    or mod(extract(epoch from new.due_at - t.starts_at)::numeric, t.every_hours * 3600) <> 0
    or new.due_at > now() + interval '1 hour'
    or new.due_at > least(coalesce(t.ends_at, 'infinity'), coalesce(t.stopped_at, 'infinity'), coalesce(s.discharged_at, 'infinity')) then
    raise exception 'This dose is not due yet' using errcode = 'P0001';
  end if;
  new.done_at := now();
  new.done_by := auth.uid();
  return new;
end;
$$;
create trigger inpatient_task_doses_fill before insert on inpatient_task_doses
  for each row execute function public.fill_inpatient_task_dose();

-- Every due time in [p_from, p_to] of the reminders the caller can see (RLS), with the dose if done.
-- Starts from the first due time at or after p_from, so a long stay doesn't generate its whole past.
create function public.inpatient_task_slots(p_from timestamptz, p_to timestamptz)
returns table (task_id uuid, stay_id uuid, due_at timestamptz, done_at timestamptz, done_by_name text)
language sql stable
set search_path = public
as $$
  select t.id, t.stay_id, gs, d.done_at, p.full_name
  from inpatient_tasks t
  join inpatient_stays s on s.id = t.stay_id
  cross join lateral generate_series(
    t.starts_at + make_interval(hours => t.every_hours * greatest(0, ceil(extract(epoch from p_from - t.starts_at) / 3600 / t.every_hours))::integer),
    least(p_to, coalesce(t.ends_at, 'infinity'), coalesce(t.stopped_at, 'infinity'), coalesce(s.discharged_at, 'infinity')),
    make_interval(hours => t.every_hours)
  ) gs
  left join inpatient_task_doses d on d.task_id = t.id and d.due_at = gs
  left join profiles p on p.id = d.done_by
  order by gs, t.id;
$$;
revoke execute on function public.inpatient_task_slots(timestamptz, timestamptz) from public, anon;
grant execute on function public.inpatient_task_slots(timestamptz, timestamptz) to authenticated, service_role;
