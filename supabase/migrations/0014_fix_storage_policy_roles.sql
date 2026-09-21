-- Touq / طوق — Supabase Storage's API doesn't run requests under the
-- Postgres role literally named "authenticated" the way PostgREST does, so
-- policies scoped "to authenticated" silently never match storage uploads.
-- Dropping the role restriction; the clinic_id match in the check itself
-- already blocks anonymous/cross-clinic writes (current_user_clinic_id()
-- returns null for non-vets, and null never equals a folder name).

drop policy "pet_photos_insert_own_clinic" on storage.objects;
drop policy "pet_photos_update_own_clinic" on storage.objects;
drop policy "pet_photos_delete_own_clinic" on storage.objects;

create policy "pet_photos_insert_own_clinic" on storage.objects
  for insert
  with check (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = public.current_user_clinic_id()::text
  );

create policy "pet_photos_update_own_clinic" on storage.objects
  for update
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = public.current_user_clinic_id()::text
  );

create policy "pet_photos_delete_own_clinic" on storage.objects
  for delete
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = public.current_user_clinic_id()::text
  );
