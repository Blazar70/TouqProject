-- Touq / طوق — the missing piece: upload(..., { upsert: true }) compiles to
-- INSERT ... ON CONFLICT DO UPDATE, which needs to read any existing
-- conflicting row to evaluate the UPDATE branch. With no SELECT policy on
-- storage.objects at all, that internal read is denied, and the whole
-- statement fails RLS — even for a brand-new path with no real conflict.
create policy "pet_photos_select_all" on storage.objects
  for select
  using (bucket_id = 'pet-photos');
