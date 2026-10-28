-- Admin import of a clinic's existing owners and pets from a CSV (user 10-29: the Touq admin does it as onboarding,
-- clinics never see it). One call = one transaction: a bad row stops the whole import, nothing half-saved.
-- Owners are matched by phone (owner_phone_key, 0063) to the clinic's existing owners and to each other;
-- a row without a phone gets its own new owner.
-- p_rows: [{owner_name, owner_phone, owner_email, pet_name, species, breed, date_of_birth}], text values,
-- already cleaned by the app (src/lib/csvImport.ts); checked again here.

create function public.admin_import_owners_pets(p_clinic uuid, p_rows jsonb)
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

    insert into pets (clinic_id, owner_file_id, owner_name, name, species, breed, date_of_birth)
    values (p_clinic, v_owner, v_name, btrim(v_row ->> 'pet_name'), btrim(v_row ->> 'species'),
      nullif(btrim(v_row ->> 'breed'), ''), nullif(v_row ->> 'date_of_birth', '')::date);
  end loop;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  values (auth.uid(), (select full_name from profiles where id = auth.uid()), 'owners_pets_imported', 'clinic',
    format('%s (%s pets, %s new owners, %s existing owners)', v_clinic_name, v_n, v_new_owners, v_matched), p_clinic);

  return jsonb_build_object('pets', v_n, 'new_owners', v_new_owners, 'matched_owners', v_matched);
end;
$$;

revoke execute on function public.admin_import_owners_pets(uuid, jsonb) from public, anon;
grant execute on function public.admin_import_owners_pets(uuid, jsonb) to authenticated;
