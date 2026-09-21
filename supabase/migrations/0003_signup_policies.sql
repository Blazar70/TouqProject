-- Touq / طوق — allow new users to create their own profile (and a clinic, if signing up as a vet)
-- Run in the Supabase SQL editor after 0002_status_columns_to_text.sql.

-- A brand new user has no profile row yet, so this only checks that the row
-- they're inserting is for themselves.
create policy "profiles_insert_own" on profiles
  for insert with check (id = auth.uid());

-- Any logged-in user can create a clinic (this happens once, during vet signup).
-- Clinic edits/deletes stay restricted to that clinic's vets via the existing
-- "clinics_select_vet" style policies plus the pets_all_vet-style scoping.
create policy "clinics_insert_authenticated" on clinics
  for insert with check (auth.uid() is not null);
