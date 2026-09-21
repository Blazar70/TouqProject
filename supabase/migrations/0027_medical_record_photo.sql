-- Touq / طوق — optional photo attached to a medical record (e.g. a
-- completed appointment). Same "pet-photos" storage bucket, a different
-- path prefix (records/) so it can't collide with a pet's own photo_url.
alter table medical_records add column photo_url text;
