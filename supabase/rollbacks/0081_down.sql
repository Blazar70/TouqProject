-- Rollback for 0081_inpatients.sql. LOSES every stay and update. The inpatient-media bucket and its
-- files stay: SQL can't delete Storage rows (storage.protect_delete), so empty and delete the bucket
-- in the dashboard (or the Storage API) afterwards if wanted.
drop policy inpatient_media_select_own_clinic on storage.objects;
drop policy inpatient_media_insert_own_clinic on storage.objects;
drop policy inpatient_media_delete_own_clinic on storage.objects;
drop table inpatient_updates;
drop table inpatient_stays;
drop function public.move_inpatient_to_update_branch();
drop function public.fill_inpatient_stay();
