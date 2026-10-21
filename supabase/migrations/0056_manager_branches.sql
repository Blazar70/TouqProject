-- Touq / طوق — phase 3: managers manage branches from Settings (decided 2026-10-21).
-- Whole-clinic managers (no staff_branches rows, 0047) get the admin's branch
-- controls for their own clinic: add, edit, make main, close/reopen.
-- Branch managers may only edit name/name_ar/phone/address of their own branches.
-- Writing appointments/invoices only into your own branches is phase 4.

create function public.current_user_is_clinic_manager()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.current_user_has_role(array['manager'])
    and not exists (select 1 from staff_branches where profile_id = auth.uid());
$$;

create policy "branches_insert_manager" on branches
  for insert
  with check (clinic_id = (select current_user_clinic_id()) and (select current_user_is_clinic_manager()));

create policy "branches_update_manager" on branches
  for update
  using (
    clinic_id = (select current_user_clinic_id())
    and (
      (select current_user_is_clinic_manager())
      or ((select current_user_has_role(array['manager'])) and id in (select current_user_branch_ids()))
    )
  )
  with check (clinic_id = (select current_user_clinic_id()));

-- RLS can't limit columns: a branch manager may not close, reopen or make main.
create function public.enforce_branch_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
    and auth.role() is distinct from 'service_role'
    and not public.current_user_is_admin()
    and not public.current_user_is_clinic_manager()
    and (new.active is distinct from old.active or new.is_main is distinct from old.is_main or new.clinic_id is distinct from old.clinic_id)
  then
    raise exception 'only an admin or a whole-clinic manager may close, reopen or change the main branch';
  end if;
  return new;
end;
$$;

create trigger branches_enforce_update
  before update on branches
  for each row execute function public.enforce_branch_update();

-- Now security definer (close also moves staff_branches rows, which managers
-- can't write directly), so the caller check below is the only gate.
create or replace function public.admin_set_main_branch(p_branch uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from branches where id = p_branch and active;
  if v_clinic is null then
    raise exception 'branch not found or closed';
  end if;
  if not (current_user_is_admin() or (current_user_is_clinic_manager() and v_clinic = current_user_clinic_id())) then
    raise exception 'only an admin or a whole-clinic manager may change the main branch';
  end if;
  update branches set is_main = false where clinic_id = v_clinic and is_main;
  update branches set is_main = true where id = p_branch;
end;
$$;

create or replace function public.admin_close_branch(p_branch uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_clinic uuid;
  v_main uuid;
  v_moved integer;
begin
  select b.clinic_id, m.id into v_clinic, v_main
  from branches b join branches m on m.clinic_id = b.clinic_id and m.is_main
  where b.id = p_branch and b.active and not b.is_main;
  if v_main is null then
    raise exception 'branch not found, already closed, or is the main branch';
  end if;
  if not (current_user_is_admin() or (current_user_is_clinic_manager() and v_clinic = current_user_clinic_id())) then
    raise exception 'only an admin or a whole-clinic manager may close a branch';
  end if;

  insert into staff_branches (profile_id, branch_id)
  select sb.profile_id, v_main
  from staff_branches sb
  where sb.branch_id = p_branch
    and not exists (select 1 from staff_branches o where o.profile_id = sb.profile_id and o.branch_id <> p_branch);
  get diagnostics v_moved = row_count;

  delete from staff_branches where branch_id = p_branch;
  update branches set active = false where id = p_branch;
  return v_moved;
end;
$$;
