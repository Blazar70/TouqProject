-- Touq / طوق — temporary diagnostic: an unconditionally-true policy, to
-- check whether any policy we create is actually being applied at all
-- during a real Storage API upload. Not meant to stay this permissive —
-- see chat for what replaces it once we understand what's happening.

drop policy "pet_photos_insert_authenticated" on storage.objects;
drop policy "pet_photos_update_authenticated" on storage.objects;
drop policy "pet_photos_delete_authenticated" on storage.objects;

create policy "pet_photos_insert_test_open" on storage.objects
  for insert
  with check (bucket_id = 'pet-photos');
