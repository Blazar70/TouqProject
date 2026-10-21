-- Touq / طوق — image bucket limits (nightly report S4, 2026-10-21). The 5 MB
-- and "image only" checks were client-side only (src/lib/imageUpload.ts), and
-- image/* lets SVG through, which can carry script, in a PUBLIC bucket too
-- (clinic-logos). Storage now refuses anything but photo formats over 5 MB.
-- HEIC/HEIF stay allowed for iPhone photos.

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
where id in ('pet-photos', 'clinic-logos');
