-- Undoes 0053_clinic_logo.sql: psql "$DATABASE_URL" -1 -f <file>.
-- Logo paths are lost. Empty the clinic-logos bucket in the dashboard (or the
-- Storage API) first so the files go too; the bucket delete below fails while
-- it still has objects.

drop trigger clinics_enforce_logo_update on clinics;
drop function public.enforce_clinic_logo_update();

drop policy "clinic_logos_select" on storage.objects;
drop policy "clinic_logos_insert" on storage.objects;
drop policy "clinic_logos_update" on storage.objects;
drop policy "clinic_logos_delete" on storage.objects;
drop function public.can_manage_clinic_logo(text);

-- Supabase blocks SQL deletes on storage tables unless this is set.
set local storage.allow_delete_query = 'true';
delete from storage.buckets where id = 'clinic-logos';

alter table clinics drop column logo_url;
