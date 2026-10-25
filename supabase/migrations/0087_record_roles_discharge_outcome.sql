-- Touq / طوق — nightly report 2026-10-25 fixes (user said fix, 2026-10-25).
-- S11: visit records were writable by every clinic role; 0075 only limited nurses. Now only doctors,
--      nurses (their 0075 limits stay) and managers may add, edit or delete them. Reception reads.
-- B12: a stay had no outcome, so the Reminders page offered "ready to go home" for a pet that died.
--      Discharge now records an outcome; only 'home' gets a pickup reminder (see RemindersPage).
-- H20: a reminder that no longer applies can be skipped (owner_reminders_sent.skipped), with Undo.
-- S12: any staff member could delete any inpatient photo/video straight from storage. Now only the
--      uploader, a manager, or anyone once the pet itself is purged (PetsPage removes its files).

-- ---------------------------------------------------------------- S11
create or replace function public.enforce_medical_record_roles()
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

  -- 0087: clinical history is written by clinicians only.
  if v_role is distinct from 'doctor' and v_role is distinct from 'nurse' and v_role is distinct from 'manager' then
    raise exception 'Only doctors, nurses and managers can change visit records' using errcode = 'P0001';
  end if;

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

-- ---------------------------------------------------------------- B12
-- Older discharges have no outcome (null): they never get a pickup reminder.
alter table inpatient_stays add column discharge_outcome text
  check (discharge_outcome in ('home', 'died', 'euthanised', 'transferred'));
alter table inpatient_stays add constraint inpatient_stays_outcome_on_discharge
  check (discharge_outcome is null or discharged_at is not null);
grant update (discharge_outcome) on inpatient_stays to authenticated;

-- ---------------------------------------------------------------- H20
alter table owner_reminders_sent add column skipped boolean not null default false;

-- ---------------------------------------------------------------- S12
drop policy inpatient_media_delete_own_clinic on storage.objects;
create policy inpatient_media_delete_own_clinic on storage.objects for delete
  using (
    bucket_id = 'inpatient-media'
    and (storage.foldername(name))[1] = public.current_user_clinic_id()::text
    and (
      owner_id = auth.uid()::text
      or public.current_user_has_role(array['manager'])
      -- objects.name, not name: inside this subquery a bare "name" is the pet's name.
      or not exists (select 1 from public.pets where id::text = (storage.foldername(objects.name))[2])
    )
  );
