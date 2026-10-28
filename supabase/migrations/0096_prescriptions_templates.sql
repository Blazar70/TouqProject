-- Prescriptions and visit templates (user 10-29).
-- (a) A prescription = medicine lines on the visit record, written by doctors/managers only (nurses refused like
--     the diagnosis, 0075). Each line: {medicine, dose, frequency, duration, note}, all text.
-- (b) visit_templates: ready-made record texts + prescription, shared by the whole clinic; doctors and managers
--     write them, every clinician reads them.

-- ---------------------------------------------------------------- (a)
alter table medical_records
  add column prescription jsonb not null default '[]'::jsonb
    check (jsonb_typeof(prescription) = 'array' and jsonb_array_length(prescription) <= 30);

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
    -- 0096: prescribing is a doctor's act too.
    if (tg_op = 'INSERT' and new.prescription <> '[]'::jsonb)
      or (tg_op = 'UPDATE' and new.prescription is distinct from old.prescription) then
      raise exception 'Nurses can''t write a prescription' using errcode = 'P0001';
    end if;
    -- 0088: the pre-0040 Notes field follows the same rule (it can hold a diagnosis).
    if (tg_op = 'INSERT' and new.notes is not null) or (tg_op = 'UPDATE' and new.notes is distinct from old.notes) then
      raise exception 'Nurses can''t change the old Notes field' using errcode = 'P0001';
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

-- ---------------------------------------------------------------- (b)
create table visit_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 100),
  -- Record texts keyed like the form (complaint, physicalExam, diagnosis, diagnosticPlan, treatment, remarks).
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  prescription jsonb not null default '[]'::jsonb
    check (jsonb_typeof(prescription) = 'array' and jsonb_array_length(prescription) <= 30),
  created_by uuid references profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index visit_templates_clinic_name_idx on visit_templates (clinic_id, lower(btrim(name)));

alter table visit_templates enable row level security;
create policy "visit_templates_select_clinicians" on visit_templates
  for select using (
    clinic_id = (select current_user_clinic_id()) and public.current_user_has_role(array['doctor', 'nurse', 'manager'])
  );
create policy "visit_templates_write_doctors" on visit_templates
  for all using (clinic_id = (select current_user_clinic_id()) and public.current_user_has_role(array['doctor', 'manager']))
  with check (clinic_id = (select current_user_clinic_id()) and public.current_user_has_role(array['doctor', 'manager']));
create policy "visit_templates_all_admin" on visit_templates
  for all using (current_user_is_admin());
