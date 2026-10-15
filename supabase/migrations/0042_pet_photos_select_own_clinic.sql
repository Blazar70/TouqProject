-- Touq / طوق — pet_photos_select_all (0019) let anyone, logged out included,
-- list every object in pet-photos: every clinic's pet and medical-record
-- photo paths. Scope SELECT to the caller's own clinic folder, same as the
-- write policies (0020), so the upsert conflict check still sees its own rows.
-- Displaying photos is unaffected: public-bucket URLs don't go through RLS.
-- Already applied to live by hand; this file records it (safe to re-run).

drop policy if exists "pet_photos_select_all" on storage.objects;
drop policy if exists "pet_photos_select_own_clinic" on storage.objects;

create policy "pet_photos_select_own_clinic" on storage.objects
  for select
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = public.current_user_clinic_id()::text
  );
