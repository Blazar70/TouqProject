-- Touq / طوق — pet profile photos, stored in a public Supabase Storage bucket.
-- Files are stored at "<clinic_id>/<pet_id>.<ext>" so a policy can scope
-- writes to the uploader's own clinic. The bucket is public so photos load
-- directly via CDN URL without needing signed URLs or a select policy.

insert into storage.buckets (id, name, public)
values ('pet-photos', 'pet-photos', true);

create policy "pet_photos_insert_own_clinic" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = current_user_clinic_id()::text
  );

create policy "pet_photos_update_own_clinic" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = current_user_clinic_id()::text
  );

create policy "pet_photos_delete_own_clinic" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pet-photos'
    and (storage.foldername(name))[1] = current_user_clinic_id()::text
  );

alter table pets add column photo_url text;
