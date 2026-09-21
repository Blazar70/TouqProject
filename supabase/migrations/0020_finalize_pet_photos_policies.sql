-- Touq / طوق — replace the wide-open test policies from this debugging
-- session with the real clinic-scoped ones. SELECT stays open to the whole
-- bucket (harmless — the bucket is already public for reads, and a
-- restrictive SELECT policy would just break the upsert conflict-check
-- again for legitimate clinic-scoped writes reading their own rows).

drop policy "pet_photos_insert_test_open" on storage.objects;
drop policy "pet_photos_update_test_open" on storage.objects;
drop policy "debug_test_bucket_all" on storage.objects;

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

drop function if exists public.debug_clinic_fn();
