-- Rollback for 0090_owner_anonymise_log.sql: back to the 0089 function. Log labels already rewritten stay anonymous.
create or replace function public.anonymise_owner_file(p_owner uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_owner owner_files;
  v_label text;
begin
  if not public.current_user_has_role(array['manager']) and not public.current_user_is_admin() then
    raise exception 'Only a manager can delete an owner''s personal data' using errcode = '42501';
  end if;
  select * into v_owner from owner_files where id = p_owner and clinic_id = public.current_user_clinic_id() for update;
  if not found then
    raise exception 'Owner not found' using errcode = 'P0001';
  end if;
  if v_owner.anonymised_at is not null then
    raise exception 'This owner was already anonymised' using errcode = 'P0001';
  end if;

  v_label := 'Deleted owner #' || left(p_owner::text, 6);
  update owner_files set name = v_label, phone = null, email = null, notes = null, anonymised_at = now() where id = p_owner;
  delete from pet_trusted_contacts where pet_id in (select id from pets where owner_file_id = p_owner);

  -- The log names only the anonymous label: writing the real name here would keep it.
  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), 'owner_anonymised', 'owner', v_label, v_owner.clinic_id
  from (select 1) one left join profiles p on p.id = auth.uid();
end;
$$;
