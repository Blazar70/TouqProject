-- Rollback for 0088_phase4_shortcuts.sql. Puts the balance back on owner_files (values kept).
drop trigger owner_balance_entries_y_branch_required on owner_balance_entries;
drop function public.require_balance_entry_branch();
drop index medical_records_one_per_visit;

alter table owner_files add column balance numeric(10, 2) not null default 0 check (balance >= 0);
update owner_files o set balance = b.balance from owner_balances b where b.owner_file_id = o.id;

-- The 0064 functions, verbatim.
create or replace function public.apply_owner_balance_entry()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  select balance into v_balance from owner_files
  where id = new.owner_file_id and clinic_id = new.clinic_id for update;
  if not found then
    raise exception 'Owner not found' using errcode = 'P0001';
  end if;
  if v_balance + new.amount < 0 then
    raise exception 'Not enough balance (available %)', to_char(v_balance, 'FM999999990.00') using errcode = 'P0001';
  end if;
  update owner_files set balance = balance + new.amount where id = new.owner_file_id;
  return new;
end;
$$;

create or replace function public.merge_owner_files(p_keep uuid, p_remove uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_clinic uuid := public.current_user_clinic_id();
  v_keep owner_files;
  v_remove owner_files;
begin
  if v_clinic is null then
    raise exception 'Only clinic staff can merge owners' using errcode = '42501';
  end if;
  -- Lock both in id order so two merges can't deadlock.
  perform 1 from owner_files where id in (p_keep, p_remove) and clinic_id = v_clinic order by id for update;
  select * into v_keep from owner_files where id = p_keep and clinic_id = v_clinic;
  select * into v_remove from owner_files where id = p_remove and clinic_id = v_clinic;
  if v_keep.id is null or v_remove.id is null or p_keep = p_remove then
    raise exception 'Pick two different owners of this clinic' using errcode = 'P0001';
  end if;

  update owner_files set
    phone = coalesce(nullif(btrim(phone), ''), v_remove.phone),
    email = coalesce(nullif(btrim(email), ''), v_remove.email),
    notes = nullif(concat_ws(E'\n', nullif(btrim(notes), ''), nullif(btrim(v_remove.notes), '')), ''),
    balance = balance + v_remove.balance
  where id = p_keep;
  update pets set owner_file_id = p_keep where owner_file_id = p_remove;
  update owner_balance_entries set owner_file_id = p_keep where owner_file_id = p_remove;
  delete from owner_files where id = p_remove;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), 'owners_merged', 'owner',
         v_remove.name || ' → ' || v_keep.name || ' · ' || v_remove.balance, v_clinic
  from (select 1) one left join profiles p on p.id = auth.uid();
end;
$$;

drop table owner_balances;

-- The 0087 enforce_medical_record_roles, verbatim.
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
