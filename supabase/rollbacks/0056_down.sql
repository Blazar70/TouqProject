-- Rollback for 0056_manager_branches.sql: back to admin-only branch writes (0048).
drop trigger if exists branches_enforce_update on branches;
drop function if exists public.enforce_branch_update();
drop policy if exists "branches_update_manager" on branches;
drop policy if exists "branches_insert_manager" on branches;

create or replace function public.admin_set_main_branch(p_branch uuid)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  v_clinic uuid;
begin
  if not current_user_is_admin() then
    raise exception 'only an admin may change the main branch';
  end if;
  select clinic_id into v_clinic from branches where id = p_branch and active;
  if v_clinic is null then
    raise exception 'branch not found or closed';
  end if;
  update branches set is_main = false where clinic_id = v_clinic and is_main;
  update branches set is_main = true where id = p_branch;
end;
$$;

create or replace function public.admin_close_branch(p_branch uuid)
returns integer
language plpgsql security invoker
set search_path = public
as $$
declare
  v_main uuid;
  v_moved integer;
begin
  if not current_user_is_admin() then
    raise exception 'only an admin may close a branch';
  end if;
  select m.id into v_main
  from branches b join branches m on m.clinic_id = b.clinic_id and m.is_main
  where b.id = p_branch and b.active and not b.is_main;
  if v_main is null then
    raise exception 'branch not found, already closed, or is the main branch';
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

drop function if exists public.current_user_is_clinic_manager();
