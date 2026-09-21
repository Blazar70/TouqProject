-- Touq / طوق — "caregivers" means clinic staff (vet techs, assistants),
-- not a per-pet contact. Restructuring the table from pet-scoped to
-- clinic-scoped. Safe to alter in place since no real data exists in this
-- table yet.

drop policy "caregivers_all_vet" on caregivers;
drop policy "caregivers_select_owner" on caregivers;

alter table caregivers drop constraint caregivers_pet_id_fkey;
alter table caregivers drop column pet_id;
alter table caregivers drop column relationship;

alter table caregivers add column clinic_id uuid references clinics (id);
update caregivers set clinic_id = (select id from clinics limit 1); -- no-op if table is empty
alter table caregivers alter column clinic_id set not null;
alter table caregivers add column title text;

create policy "caregivers_all_vet" on caregivers
  for all using (clinic_id = current_user_clinic_id());
