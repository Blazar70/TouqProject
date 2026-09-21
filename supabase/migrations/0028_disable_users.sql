-- Touq / طوق — lets an admin disable a user's account (manually, from the
-- Admin page). Payment-based auto-disabling is a later feature; this is
-- just the on/off switch and the RLS enforcement behind it.
--
-- profiles_select_own / profiles_update_own are deliberately left
-- unrestricted by `disabled` — a disabled user still needs to be able to
-- read their own profile (so the app can show a clear "account disabled"
-- screen instead of a confusing empty state) and the update path is
-- harmless (name/phone only; every other table is locked down below).

alter table profiles add column disabled boolean not null default false;

-- current_user_clinic_id() backs every *_all_vet policy and
-- current_user_is_admin() backs every *_all_admin policy — gating both
-- here blocks a disabled vet or admin from all clinic/cross-clinic data
-- without having to touch each of those policies individually.
create or replace function public.current_user_clinic_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select clinic_id from profiles where id = auth.uid() and role = 'vet' and not disabled;
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and not disabled
  );
$$;

-- Owner-scoped policies check `auth.uid()` directly rather than going
-- through a helper, so they need their own active-user gate.
create or replace function public.current_user_id_if_active()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select case when (select disabled from profiles where id = auth.uid()) then null else auth.uid() end;
$$;

drop policy if exists "clinics_select_owner" on clinics;
create policy "clinics_select_owner" on clinics
  for select using (
    id in (select clinic_id from pets where owner_id = public.current_user_id_if_active())
  );

drop policy if exists "pets_select_owner" on pets;
create policy "pets_select_owner" on pets
  for select using (owner_id = public.current_user_id_if_active());

drop policy if exists "pets_update_owner" on pets;
create policy "pets_update_owner" on pets
  for update using (owner_id = public.current_user_id_if_active());

drop policy if exists "medical_records_select_owner" on medical_records;
create policy "medical_records_select_owner" on medical_records
  for select using (
    pet_id in (select id from pets where owner_id = public.current_user_id_if_active())
  );

drop policy if exists "appointments_all_owner" on appointments;
create policy "appointments_all_owner" on appointments
  for all using (
    pet_id in (select id from pets where owner_id = public.current_user_id_if_active())
  );

drop policy if exists "payments_select_owner" on payments;
create policy "payments_select_owner" on payments
  for select using (owner_id = public.current_user_id_if_active());

drop policy if exists "ownership_transfers_select_parties" on ownership_transfers;
create policy "ownership_transfers_select_parties" on ownership_transfers
  for select using (
    from_owner_id = public.current_user_id_if_active() or to_owner_id = public.current_user_id_if_active()
  );

drop policy if exists "ownership_transfers_insert_owner" on ownership_transfers;
create policy "ownership_transfers_insert_owner" on ownership_transfers
  for insert with check (from_owner_id = public.current_user_id_if_active());

drop policy if exists "ownership_transfers_update_recipient" on ownership_transfers;
create policy "ownership_transfers_update_recipient" on ownership_transfers
  for update using (to_owner_id = public.current_user_id_if_active());
