-- Checks for migration 0055 (image bucket limits). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0055_image_bucket_limits_check.sql
-- Storage enforces these limits in its API, not in SQL, so this checks the
-- bucket settings; the upload refusal itself is checked through the app.

do $$
declare
  b record;
begin
  for b in select id, file_size_limit, allowed_mime_types from storage.buckets where id in ('pet-photos', 'clinic-logos') loop
    assert b.file_size_limit = 5242880, b.id || ': size limit not 5 MB';
    assert 'image/jpeg' = any (b.allowed_mime_types), b.id || ': jpeg not allowed';
    assert 'image/heic' = any (b.allowed_mime_types), b.id || ': heic not allowed';
    assert not ('image/svg+xml' = any (b.allowed_mime_types)), b.id || ': svg allowed';
  end loop;
  assert (select count(*) from storage.buckets where id in ('pet-photos', 'clinic-logos') and allowed_mime_types is not null) = 2,
    'a bucket has no type list';
end $$;

select 'all 0055 checks passed' as result;
