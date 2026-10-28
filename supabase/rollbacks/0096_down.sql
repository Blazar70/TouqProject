-- Undo 0096: templates dropped, prescription column dropped, record trigger back to its 0088 body.
drop table visit_templates;

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

alter table medical_records drop column prescription;
