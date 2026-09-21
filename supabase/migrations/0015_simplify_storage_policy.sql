-- Touq / طوق — simplify the pet-photos storage policy to isolate whether
-- the failure is auth.uid() itself or the custom clinic-matching function,
-- when evaluated inside Supabase Storage's RLS context (a different code
-- path than PostgREST, which is where our earlier debug function ran).

drop policy "pet_photos_insert_own_clinic" on storage.objects;
drop policy "pet_photos_update_own_clinic" on storage.objects;
drop policy "pet_photos_delete_own_clinic" on storage.objects;

create policy "pet_photos_insert_authenticated" on storage.objects
  for insert
  with check (bucket_id = 'pet-photos' and auth.uid() is not null);

create policy "pet_photos_update_authenticated" on storage.objects
  for update
  using (bucket_id = 'pet-photos' and auth.uid() is not null);

create policy "pet_photos_delete_authenticated" on storage.objects
  for delete
  using (bucket_id = 'pet-photos' and auth.uid() is not null);
