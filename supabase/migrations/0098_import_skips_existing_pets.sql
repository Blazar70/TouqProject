-- Admin import (0097) skips a pet the same owner already has (same name and species, ignoring case and spaces),
-- so a second run of a corrected file or a retry after a dropped connection doesn't double every pet (nightly B26).
-- Returns 'skipped' too.

create or replace function public.admin_import_owners_pets(p_clinic uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_n int := 0;
  v_key text;
  v_owner uuid;
  v_keys jsonb := '{}'::jsonb; -- phone key -> owner id, for this import
  v_new_owners int := 0;
  v_matched int := 0;
  v_skipped int := 0;
  v_name text;
  v_phone text;
  v_clinic_name text;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only the Touq admin can import' using errcode = 'P0001';
  end if;
  select name into v_clinic_name from clinics where id = p_clinic;
  if v_clinic_name is null then
    raise exception 'Clinic not found' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import between 1 and 5000 rows' using errcode = 'P0001';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    v_name := nullif(btrim(v_row ->> 'owner_name'), '');
    v_phone := nullif(btrim(v_row ->> 'owner_phone'), '');
    if v_name is null or nullif(btrim(v_row ->> 'pet_name'), '') is null or nullif(btrim(v_row ->> 'species'), '') is null then
      raise exception 'Import row % is missing the owner name, pet name or species', v_n using errcode = 'P0001';
    end if;
    if v_phone is not null and v_phone !~ '^\+9665[0-9]{8}$' then
      raise exception 'Import row % has a phone that is not a Saudi mobile', v_n using errcode = 'P0001';
    end if;

    v_key := public.owner_phone_key(v_phone);
    v_owner := (v_keys ->> v_key)::uuid;
    if v_owner is null and v_key is not null then
      select id into v_owner from owner_files
      where clinic_id = p_clinic and public.owner_phone_key(phone) = v_key
      order by created_at limit 1;
      if v_owner is not null then
        v_matched := v_matched + 1;
      end if;
    end if;
    if v_owner is null then
      insert into owner_files (clinic_id, name, phone, email)
      values (p_clinic, v_name, v_phone, nullif(btrim(v_row ->> 'owner_email'), ''))
      returning id into v_owner;
      v_new_owners := v_new_owners + 1;
    end if;
    if v_key is not null then
      v_keys := v_keys || jsonb_build_object(v_key, v_owner);
    end if;

    -- Same owner already has this pet (an earlier run, or a retry after a dropped connection): skip it.
    if exists (
      select 1 from pets
      where owner_file_id = v_owner and deleted_at is null
        and lower(btrim(name)) = lower(btrim(v_row ->> 'pet_name')) and lower(species) = lower(btrim(v_row ->> 'species'))
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into pets (clinic_id, owner_file_id, owner_name, name, species, breed, date_of_birth)
    values (p_clinic, v_owner, v_name, btrim(v_row ->> 'pet_name'), btrim(v_row ->> 'species'),
      nullif(btrim(v_row ->> 'breed'), ''), nullif(v_row ->> 'date_of_birth', '')::date);
  end loop;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  values (auth.uid(), (select full_name from profiles where id = auth.uid()), 'owners_pets_imported', 'clinic',
    format('%s (%s pets, %s new owners, %s existing owners, %s already there)', v_clinic_name, v_n - v_skipped, v_new_owners, v_matched, v_skipped), p_clinic);

  return jsonb_build_object('pets', v_n - v_skipped, 'new_owners', v_new_owners, 'matched_owners', v_matched, 'skipped', v_skipped);
end;
$$;
