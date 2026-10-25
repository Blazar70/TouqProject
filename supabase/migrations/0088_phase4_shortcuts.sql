-- Touq / طوق — the five phase-4 shortcuts, fixed (user said do them, 2026-10-25).
-- (a) owner_files.balance was readable through the API by every clinic role. It moves to its own table,
--     owner_balances, readable by receptionists and managers only. Same ledger rules as 0064.
-- (b) Nurses could still write the pre-0040 Notes field on visit records; now blocked like diagnosis.
-- (c) Nurse on prints: app only (PrintContext, record selects).
-- (d) Two first saves of one session at the same moment made two visit records: one record per
--     appointment is now enforced (SessionPage reloads and updates on a clash).
-- (e) A balance entry inserted without a branch skipped the branch check; staff entries now need one.

-- ---------------------------------------------------------------- (a)
create table owner_balances (
  owner_file_id uuid primary key references owner_files (id) on delete cascade,
  clinic_id uuid not null references clinics (id) on delete cascade,
  balance numeric(10, 2) not null default 0 check (balance >= 0)
);
insert into owner_balances (owner_file_id, clinic_id, balance)
  select id, clinic_id, balance from owner_files where balance <> 0;

alter table owner_balances enable row level security;
revoke insert, update, delete on owner_balances from anon, authenticated;
create policy owner_balances_select_money on owner_balances for select
  using (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['receptionist', 'manager'])));
create policy owner_balances_select_admin on owner_balances for select using (public.current_user_is_admin());

create or replace function public.apply_owner_balance_entry()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  -- The owner row lock keeps two entries for one owner in order, as before 0088.
  perform 1 from owner_files where id = new.owner_file_id and clinic_id = new.clinic_id for update;
  if not found then
    raise exception 'Owner not found' using errcode = 'P0001';
  end if;
  insert into owner_balances (owner_file_id, clinic_id) values (new.owner_file_id, new.clinic_id) on conflict do nothing;
  select balance into v_balance from owner_balances where owner_file_id = new.owner_file_id;
  if v_balance + new.amount < 0 then
    raise exception 'Not enough balance (available %)', to_char(v_balance, 'FM999999990.00') using errcode = 'P0001';
  end if;
  update owner_balances set balance = balance + new.amount where owner_file_id = new.owner_file_id;
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
  v_moved numeric := 0;
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
    notes = nullif(concat_ws(E'\n', nullif(btrim(notes), ''), nullif(btrim(v_remove.notes), '')), '')
  where id = p_keep;
  -- 0088: the balance lives in owner_balances.
  select coalesce((select balance from owner_balances where owner_file_id = p_remove), 0) into v_moved;
  insert into owner_balances (owner_file_id, clinic_id, balance) values (p_keep, v_clinic, v_moved)
    on conflict (owner_file_id) do update set balance = owner_balances.balance + excluded.balance;
  update pets set owner_file_id = p_keep where owner_file_id = p_remove;
  update owner_balance_entries set owner_file_id = p_keep where owner_file_id = p_remove;
  delete from owner_files where id = p_remove;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), 'owners_merged', 'owner',
         v_remove.name || ' → ' || v_keep.name || ' · ' || v_moved, v_clinic
  from (select 1) one left join profiles p on p.id = auth.uid();
end;
$$;

alter table owner_files drop column balance;

-- ---------------------------------------------------------------- (b)
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

-- ---------------------------------------------------------------- (d)
do $$
begin
  if exists (select 1 from medical_records where appointment_id is not null group by appointment_id having count(*) > 1) then
    raise exception 'Some visits have two visit records; merge them by hand before 0088 (select appointment_id, count(*) from medical_records group by 1 having count(*) > 1)';
  end if;
end $$;
create unique index medical_records_one_per_visit on medical_records (appointment_id) where appointment_id is not null;

-- ---------------------------------------------------------------- (e)
-- Depth 1 only: entries written by the invoice/credit-note triggers carry their invoice's branch.
create function public.require_balance_entry_branch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.branch_id is null and auth.uid() is not null and not public.current_user_is_admin() and pg_trigger_depth() = 1 then
    raise exception 'Pick a branch for this balance entry' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger owner_balance_entries_y_branch_required before insert on owner_balance_entries
  for each row execute function public.require_balance_entry_branch();
