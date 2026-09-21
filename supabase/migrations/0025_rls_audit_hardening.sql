-- Touq / طوق — fixes from a full RLS audit (empirically tested with a
-- second seeded clinic/vet/owner/admin account, cross-tenant probes on
-- every table, and Supabase's built-in security advisor).
--
-- 1. `enforce_pet_owner_field_restrictions()` + its trigger on `pets`
--    already existed live in the database (it's what stops an owner using
--    `pets_update_owner` from editing clinic_id/owner_id/species/breed/
--    date_of_birth — a real privilege-escalation guard) but was never
--    captured in a migration. Re-declaring it here so a fresh database
--    built from migrations doesn't silently lose this protection.
-- 2. All three SECURITY DEFINER functions had a mutable search_path
--    (flagged by `supabase db advisors`) — pinning it closes a class of
--    schema-injection risk without changing behavior.
-- 3. `pet_photos_select_all` on storage.objects was bucket-wide, letting
--    any authenticated user list every clinic's photo paths via the
--    Storage API. The app's actual photo display goes through the public
--    bucket's public URL, which bypasses storage.objects RLS entirely —
--    so this policy is only exercised by the authenticated upload-conflict
--    check (see 0019) and normal in-app usage, never by <img> tags.
--    Scoping it to the caller's own clinic folder (matching insert/update/
--    delete) closes the enumeration gap with no functional impact.

create or replace function public.current_user_clinic_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select clinic_id from profiles where id = auth.uid() and role = 'vet';
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.enforce_pet_owner_field_restrictions()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select role from profiles where id = auth.uid()) = 'owner' then
    if new.clinic_id is distinct from old.clinic_id
      or new.owner_id is distinct from old.owner_id
      or new.species is distinct from old.species
      or new.breed is distinct from old.breed
      or new.date_of_birth is distinct from old.date_of_birth
    then
      raise exception 'owners may only edit name and photo_url';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pets_owner_field_restrictions on pets;
create trigger pets_owner_field_restrictions
  before update on pets
  for each row execute function public.enforce_pet_owner_field_restrictions();

drop policy if exists "pet_photos_select_all" on storage.objects;
create policy "pet_photos_select_own_clinic" on storage.objects
  for select
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = public.current_user_clinic_id()::text
  );
