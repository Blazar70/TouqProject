-- Touq / طوق — PDPL deletion request (user decisions 2026-10-25). A manager can anonymise an owner:
-- name becomes "Deleted owner #xxxxxx", phone/email/notes are cleared (owner_files_sync_pets copies
-- that onto the owner's pets), and the pets' trusted contacts (other people's details) are deleted.
-- Kept on purpose: pets and their medical history (about the animal), invoices exactly as issued
-- (ZATCA: an issued invoice can't be edited or deleted; tax invoices print the pet, not the owner),
-- and signed waivers (legal evidence). PDPL allows keeping data another law or a legal claim needs.

alter table owner_files add column anonymised_at timestamptz;

create function public.anonymise_owner_file(p_owner uuid)
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
revoke execute on function public.anonymise_owner_file(uuid) from public, anon;
grant execute on function public.anonymise_owner_file(uuid) to authenticated;
