-- 0075: sessions and nurse rules (phase 4 part 2, user 2026-10-24).
-- * Only doctors and nurses start a session; the DB stamps who (appointments.started_by).
-- * A running session belongs to its starter plus clinicians of the other role (doctor + nurse
--   share one visit record). Only they write that record or finish the visit.
-- * Nurses write vitals/exam/remarks but never diagnosis, treatment or plan, can't delete
--   records or pets, and can't change a doctor's record once the visit is over.
-- * The record keeps both authors: vet_id (doctor, now nullable for a nurse-only visit) + nurse_id.
-- * Only doctors, nurses and managers mark vaccine doses.
-- Admins and server-side code (no auth.uid()) skip every rule here.

alter table appointments add column started_by uuid references profiles (id);
alter table medical_records add column nurse_id uuid references profiles (id);
alter table medical_records alter column vet_id drop not null;

-- Can the current user work on this appointment's session? True when it isn't running,
-- or ran before 0075 (no starter), or you started it, or you are a clinician of the other role.
create function public.can_work_session(p_appointment uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select a.status <> 'in_session' or a.started_by is null or a.started_by = auth.uid()
      or (public.current_user_has_role(array['doctor', 'nurse'])
          and public.current_user_clinic_role() is distinct from (select clinic_role from profiles where id = a.started_by))
    from appointments a where a.id = p_appointment
  ), true);
$$;
revoke execute on function public.can_work_session(uuid) from public, anon;
grant execute on function public.can_work_session(uuid) to authenticated;

-- ---------------------------------------------------------------- appointments
create function public.enforce_session_roles()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_free boolean := auth.uid() is null or public.current_user_is_admin();
begin
  if tg_op = 'UPDATE' then
    new.started_by := old.started_by; -- never set by the client
  else
    new.started_by := null;
  end if;

  if new.status = 'in_session' and (tg_op = 'INSERT' or old.status <> 'in_session') then
    if not v_free and not public.current_user_has_role(array['doctor', 'nurse']) then
      raise exception 'Only doctors and nurses can start a session' using errcode = 'P0001';
    end if;
    new.started_by := auth.uid();
  elsif tg_op = 'UPDATE' and old.status = 'in_session' then
    if new.status = 'completed' and not v_free then
      if not public.can_work_session(old.id) then
        raise exception 'Only the staff in this session can work on it' using errcode = 'P0001';
      end if;
      if public.current_user_clinic_role() = 'nurse' and exists (
        select 1 from medical_records
        where appointment_id = old.id
          and coalesce(nullif(btrim(diagnosis), ''), nullif(btrim(treatment), ''), nullif(btrim(diagnostic_plan), '')) is not null
      ) then
        raise exception 'Only the doctor can finish a visit with a diagnosis or treatment' using errcode = 'P0001';
      end if;
    elsif new.status in ('requested', 'confirmed', 'arrived') then
      new.started_by := null; -- Stop session: anyone who could stop it before still can
    end if;
  end if;
  return new;
end;
$$;

create trigger appointments_enforce_session_roles
  before insert or update on appointments
  for each row execute function public.enforce_session_roles();

-- ---------------------------------------------------------------- medical_records
create function public.enforce_medical_record_roles()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null or public.current_user_is_admin() then
    return coalesce(new, old);
  end if;
  v_role := public.current_user_clinic_role();

  if tg_op = 'DELETE' then
    if v_role = 'nurse' then
      raise exception 'Nurses can''t delete visit records or pets' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if new.appointment_id is not null and not public.can_work_session(new.appointment_id) then
    raise exception 'Only the staff in this session can work on it' using errcode = 'P0001';
  end if;

  -- Authors come from who writes, not from the client.
  if tg_op = 'UPDATE' then
    new.vet_id := old.vet_id;
    new.nurse_id := old.nurse_id;
  else
    new.vet_id := auth.uid();
    new.nurse_id := null;
  end if;

  if v_role = 'nurse' then
    if (tg_op = 'INSERT' and coalesce(new.diagnosis, new.treatment, new.diagnostic_plan) is not null)
      or (tg_op = 'UPDATE' and (new.diagnosis, new.treatment, new.diagnostic_plan)
          is distinct from (old.diagnosis, old.treatment, old.diagnostic_plan)) then
      raise exception 'Nurses can''t write the diagnosis, treatment or plan' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and old.vet_id is not null and old.vet_id <> auth.uid()
      and (select clinic_role from profiles where id = old.vet_id) is distinct from 'nurse'
      and not exists (select 1 from appointments where id = new.appointment_id and status = 'in_session') then
      raise exception 'A nurse can''t change a doctor''s record after the visit' using errcode = 'P0001';
    end if;
    if tg_op = 'INSERT' then
      new.vet_id := null;
    end if;
    new.nurse_id := auth.uid();
  elsif v_role = 'doctor' then
    new.vet_id := coalesce(new.vet_id, auth.uid()); -- a doctor joining a nurse's record becomes its doctor
  end if;
  return new;
end;
$$;

create trigger medical_records_enforce_roles
  before insert or update or delete on medical_records
  for each row execute function public.enforce_medical_record_roles();

-- ---------------------------------------------------------------- pets
create function public.enforce_pet_delete_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.current_user_is_admin()
    and public.current_user_clinic_role() = 'nurse'
    and (tg_op = 'DELETE' or (old.deleted_at is null and new.deleted_at is not null)) then
    raise exception 'Nurses can''t delete visit records or pets' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger pets_enforce_delete_role
  before update of deleted_at or delete on pets
  for each row execute function public.enforce_pet_delete_role();

-- ---------------------------------------------------------------- vaccine doses
create or replace function public.mark_vaccine_given(p_pet_vaccine uuid, p_given_on date default null)
returns date
language plpgsql security definer
set search_path = public
as $$
declare
  v pet_vaccines;
  v_today date;
  v_on date;
begin
  if not public.current_user_has_role(array['doctor', 'nurse', 'manager']) then
    raise exception 'Only doctors, nurses and managers can record vaccine doses' using errcode = 'P0001';
  end if;
  select * into v from pet_vaccines
    where id = p_pet_vaccine and clinic_id = public.current_user_clinic_id() for update;
  if not found then
    raise exception 'Vaccination not found' using errcode = 'P0001';
  end if;
  select (now() at time zone timezone)::date into v_today from clinics where id = v.clinic_id;
  v_on := coalesce(p_given_on, v_today);
  if v_on > v_today then
    raise exception 'A dose can''t be given in the future' using errcode = 'P0001';
  end if;
  insert into vaccine_doses (clinic_id, pet_vaccine_id, given_on, given_by, previous_due_date)
    values (v.clinic_id, v.id, v_on, auth.uid(), v.next_due_date);
  update pet_vaccines set next_due_date = v_on + v.interval_days where id = v.id;
  return v_on + v.interval_days;
end;
$$;

create or replace function public.undo_vaccine_dose(p_dose uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  d vaccine_doses;
begin
  if not public.current_user_has_role(array['doctor', 'nurse', 'manager']) then
    raise exception 'Only doctors, nurses and managers can record vaccine doses' using errcode = 'P0001';
  end if;
  select * into d from vaccine_doses where id = p_dose and clinic_id = public.current_user_clinic_id();
  if not found then
    raise exception 'Dose not found' using errcode = 'P0001';
  end if;
  perform 1 from pet_vaccines where id = d.pet_vaccine_id for update;
  if exists (
    select 1 from vaccine_doses
    where pet_vaccine_id = d.pet_vaccine_id and (created_at, id) > (d.created_at, d.id)
  ) then
    raise exception 'Only the latest dose can be undone' using errcode = 'P0001';
  end if;
  update pet_vaccines set next_due_date = d.previous_due_date where id = d.pet_vaccine_id;
  delete from vaccine_doses where id = d.id;
end;
$$;

notify pgrst, 'reload schema';
