-- Touq / طوق — make pet-photos private. Pet and medical-record photos were
-- readable by anyone holding the public URL; now they load through
-- short-lived signed URLs (src/lib/photoUrl.ts), which need the clinic-scoped
-- SELECT policy (0025) to sign. photo_url columns switch from a full public
-- URL to the storage path (plus an optional ?t= cache-buster), since a
-- public URL no longer works for a private bucket.

update storage.buckets set public = false where id = 'pet-photos';

update pets
set photo_url = regexp_replace(photo_url, '^.*/storage/v1/object/public/pet-photos/', '')
where photo_url like '%/storage/v1/object/public/pet-photos/%';

update medical_records
set photo_url = regexp_replace(photo_url, '^.*/storage/v1/object/public/pet-photos/', '')
where photo_url like '%/storage/v1/object/public/pet-photos/%';
