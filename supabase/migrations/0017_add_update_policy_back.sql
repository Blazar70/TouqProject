-- Touq / طوق — supabase-js's upload(..., { upsert: true }) generates an
-- INSERT ... ON CONFLICT DO UPDATE under the hood. Postgres requires a
-- satisfiable UPDATE policy for that statement to pass RLS at all, even
-- when no row actually conflicts — we'd dropped ours in the last test.
create policy "pet_photos_update_test_open" on storage.objects
  for update
  using (bucket_id = 'pet-photos');
