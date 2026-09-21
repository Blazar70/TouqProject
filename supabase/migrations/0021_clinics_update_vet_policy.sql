-- Touq / طوق — allow vets to update their own clinic's details
-- clinics only ever got SELECT policies for vets/owners (0001_init.sql) plus
-- a full admin policy (0004b_admin_policies.sql). Vets could never UPDATE
-- their own clinic (e.g. renaming it from Settings): RLS silently blocked
-- the write (0 rows affected, no error), so the save looked like it worked
-- but never actually changed anything.

create policy "clinics_update_vet" on clinics
  for update using (id = current_user_clinic_id());
