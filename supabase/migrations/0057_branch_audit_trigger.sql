-- Touq / طوق — branch changes are logged by the database (decided 2026-10-21).
-- Managers now change branches too (0056), but admin_audit_log is admin-only,
-- so the client could only log admin changes. This trigger logs every branch
-- add / edit / close / reopen / make-main by a signed-in user, whoever it is,
-- and can't be skipped. Server-side callers (no auth.uid(), e.g. the main
-- branch created with a new clinic) are not logged here.

create function public.log_branch_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if auth.uid() is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'branch_added';
  elsif new.is_main and not old.is_main then
    v_action := 'branch_made_main';
  elsif old.active and not new.active then
    v_action := 'branch_closed';
  elsif new.active and not old.active then
    v_action := 'branch_reopened';
  elsif (new.name, new.name_ar, new.phone, new.address) is distinct from (old.name, old.name_ar, old.phone, old.address) then
    v_action := 'branch_updated';
  else
    -- e.g. the old main branch losing is_main during make-main: logged once, on the new main.
    return null;
  end if;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), v_action, 'branch', new.name, new.clinic_id
  from (select 1) one
  left join profiles p on p.id = auth.uid();

  return null;
end;
$$;

create trigger branches_log_change
  after insert or update on branches
  for each row execute function public.log_branch_change();

-- Same gap for the clinic logo: managers may change it (0053) but couldn't log it.
create function public.log_clinic_logo_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null or new.logo_url is not distinct from old.logo_url then
    return null;
  end if;
  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'),
    case when new.logo_url is null then 'clinic_logo_removed' else 'clinic_logo_changed' end,
    'clinic', new.name, new.id
  from (select 1) one
  left join profiles p on p.id = auth.uid();
  return null;
end;
$$;

create trigger clinics_log_logo_change
  after update on clinics
  for each row execute function public.log_clinic_logo_change();
