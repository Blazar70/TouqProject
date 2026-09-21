-- Touq / طوق — admin RLS policies
-- Run in the Supabase SQL editor AFTER 0004_admin_role.sql has been run and
-- committed on its own (see note in that file for why).
-- Admin accounts are never created through the public signup form —
-- they're seeded directly (see scripts/seed-admin.mjs) using a key that
-- bypasses RLS, since letting anyone self-signup as admin would be a
-- security hole.

create function current_user_is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql stable security definer;

create policy "clinics_all_admin" on clinics
  for all using (current_user_is_admin());

create policy "profiles_all_admin" on profiles
  for all using (current_user_is_admin());

create policy "pets_all_admin" on pets
  for all using (current_user_is_admin());

create policy "caregivers_all_admin" on caregivers
  for all using (current_user_is_admin());

create policy "medical_records_all_admin" on medical_records
  for all using (current_user_is_admin());

create policy "appointments_all_admin" on appointments
  for all using (current_user_is_admin());

create policy "payments_all_admin" on payments
  for all using (current_user_is_admin());

create policy "ownership_transfers_all_admin" on ownership_transfers
  for all using (current_user_is_admin());
