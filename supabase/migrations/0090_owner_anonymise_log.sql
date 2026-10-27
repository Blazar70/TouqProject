-- Touq / طوق — nightly 10-26 S13 + 10-27 B21 fixes to "Delete owner data" (0089).
-- S13: older activity-log rows still held the owner's real name: balance top-ups/adjustments
-- ("<name> · 500.00 · cash", 0064) and merges ("<removed> → <kept> · n", 0064/0088). The log has
-- no owner id, so rows are matched by the name in those exact label shapes. The names of duplicate
-- owner files once merged into this one count too (a merge joins two files of the same person).
-- B21: current_user_clinic_id() is null for the platform admin, so the admin always got "Owner not found".

create or replace function public.anonymise_owner_file(p_owner uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_owner owner_files;
  v_label text;
  v_names text[];
begin
  if not public.current_user_has_role(array['manager']) and not public.current_user_is_admin() then
    raise exception 'Only a manager can delete an owner''s personal data' using errcode = '42501';
  end if;
  select * into v_owner from owner_files
  where id = p_owner and (public.current_user_is_admin() or clinic_id = public.current_user_clinic_id()) for update;
  if not found then
    raise exception 'Owner not found' using errcode = 'P0001';
  end if;
  if v_owner.anonymised_at is not null then
    raise exception 'This owner was already anonymised' using errcode = 'P0001';
  end if;

  v_label := 'Deleted owner #' || left(p_owner::text, 6);
  update owner_files set name = v_label, phone = null, email = null, notes = null, anonymised_at = now() where id = p_owner;
  delete from pet_trusted_contacts where pet_id in (select id from pets where owner_file_id = p_owner);

  -- shortcut: one merge level and exact-name matching (another owner with the very same name loses it
  -- in old log labels too); log owner ids instead of names once the log gets a target id column.
  v_names := array[v_owner.name] || array(
    select split_part(target_label, ' → ', 1) from admin_audit_log
    where clinic_id = v_owner.clinic_id and action = 'owners_merged'
      and position(' → ' || v_owner.name || ' · ' in target_label) > 0);

  update admin_audit_log l set target_label = v_label || substr(l.target_label, length(n.name) + 1)
  from unnest(v_names) n(name)
  where l.clinic_id = v_owner.clinic_id and l.target_type = 'owner'
    and l.action in ('balance_top_up', 'balance_adjusted', 'owners_merged')
    and (starts_with(l.target_label, n.name || ' · ') or starts_with(l.target_label, n.name || ' → '));

  update admin_audit_log set target_label = replace(target_label, ' → ' || v_owner.name || ' · ', ' → ' || v_label || ' · ')
  where clinic_id = v_owner.clinic_id and action = 'owners_merged'
    and position(' → ' || v_owner.name || ' · ' in target_label) > 0;

  -- The log names only the anonymous label: writing the real name here would keep it.
  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), 'owner_anonymised', 'owner', v_label, v_owner.clinic_id
  from (select 1) one left join profiles p on p.id = auth.uid();
end;
$$;
