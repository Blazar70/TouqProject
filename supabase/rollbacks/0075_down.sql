-- Rollback for 0075_session_nurse_roles.sql. Nurse-only records get the nurse as vet_id
-- again (vet_id is not null before 0075); the nurse co-author column is dropped.
drop trigger if exists appointments_enforce_session_roles on appointments;
drop trigger if exists medical_records_enforce_roles on medical_records;
drop trigger if exists pets_enforce_delete_role on pets;
drop function if exists public.enforce_session_roles();
drop function if exists public.enforce_medical_record_roles();
drop function if exists public.enforce_pet_delete_role();
drop function if exists public.can_work_session(uuid);

update medical_records set vet_id = nurse_id where vet_id is null;
alter table medical_records alter column vet_id set not null;
alter table medical_records drop column nurse_id;
alter table appointments drop column started_by;

-- Vaccine dose functions as in 0067 (no role check).
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
