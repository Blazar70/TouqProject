-- Rollback for 0055_image_bucket_limits.sql
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id in ('pet-photos', 'clinic-logos');
