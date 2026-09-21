-- Touq / طوق — initial schema
-- Run in the Supabase SQL editor, or via `supabase db push` once the CLI is linked.

-- ─────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- Clinics
-- ─────────────────────────────────────────────────────────────
create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Profiles — one row per authenticated user (vet staff or pet owner),
-- 1:1 with auth.users. role drives every RLS policy below.
-- ─────────────────────────────────────────────────────────────
create type user_role as enum ('vet', 'owner');

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null,
  clinic_id uuid references clinics (id), -- set for vets, null for owners
  full_name text not null,
  phone text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Pets
-- Vital fields (species, breed, dob, clinic_id, owner_id) are vet-only.
-- Non-vital fields (name, photo_url) may be edited by the owner.
-- Column-level enforcement lives in the trigger below since Postgres
-- RLS is row-level only.
-- ─────────────────────────────────────────────────────────────
create table pets (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  owner_id uuid not null references profiles (id),
  name text not null,
  species text not null,
  breed text,
  date_of_birth date,
  photo_url text,
  created_at timestamptz not null default now()
);

create function enforce_pet_owner_field_restrictions()
returns trigger as $$
begin
  if (select role from profiles where id = auth.uid()) = 'owner' then
    if new.clinic_id is distinct from old.clinic_id
      or new.owner_id is distinct from old.owner_id
      or new.species is distinct from old.species
      or new.breed is distinct from old.breed
      or new.date_of_birth is distinct from old.date_of_birth
    then
      raise exception 'owners may only edit name and photo_url';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger pets_owner_field_restrictions
  before update on pets
  for each row execute function enforce_pet_owner_field_restrictions();

-- ─────────────────────────────────────────────────────────────
-- Caregivers — secondary contacts attached to a pet (e.g. pet sitter),
-- vet- and owner-visible, vet-managed.
-- ─────────────────────────────────────────────────────────────
create table caregivers (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references pets (id) on delete cascade,
  name text not null,
  phone text,
  relationship text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Medical records — vet-authored, read-only to owners.
-- ─────────────────────────────────────────────────────────────
create table medical_records (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references pets (id) on delete cascade,
  clinic_id uuid not null references clinics (id),
  vet_id uuid not null references profiles (id),
  visit_date timestamptz not null default now(),
  diagnosis text,
  treatment text,
  notes text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Appointments
-- status is text + check (not enum) so new statuses can be added with a
-- constraint tweak instead of a schema migration, since these values will
-- likely churn as real clinic workflows surface edge cases.
-- ─────────────────────────────────────────────────────────────
create table appointments (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references pets (id) on delete cascade,
  clinic_id uuid not null references clinics (id),
  scheduled_at timestamptz not null,
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'completed', 'cancelled')),
  reason text,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Payments
-- ─────────────────────────────────────────────────────────────
create table payments (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references pets (id),
  clinic_id uuid not null references clinics (id),
  owner_id uuid not null references profiles (id),
  amount numeric(10, 2) not null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'overdue', 'cancelled')),
  due_date date,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Ownership transfers — audit trail for the "ownership transfer" feature.
-- ─────────────────────────────────────────────────────────────
create table ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references pets (id) on delete cascade,
  from_owner_id uuid not null references profiles (id),
  to_owner_id uuid not null references profiles (id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- Helper: is the current user a vet, and if so at which clinic?
-- ─────────────────────────────────────────────────────────────
create function current_user_clinic_id()
returns uuid as $$
  select clinic_id from profiles where id = auth.uid() and role = 'vet';
$$ language sql stable security definer;

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table clinics enable row level security;
alter table profiles enable row level security;
alter table pets enable row level security;
alter table caregivers enable row level security;
alter table medical_records enable row level security;
alter table appointments enable row level security;
alter table payments enable row level security;
alter table ownership_transfers enable row level security;

-- profiles: users can read their own profile; vets can read profiles in their clinic
create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());

create policy "profiles_select_clinic_vets" on profiles
  for select using (clinic_id = current_user_clinic_id());

create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

-- clinics: readable by their vets and by owners with a pet at that clinic
create policy "clinics_select_vet" on clinics
  for select using (id = current_user_clinic_id());

create policy "clinics_select_owner" on clinics
  for select using (
    id in (select clinic_id from pets where owner_id = auth.uid())
  );

-- pets: vets see/manage their clinic's pets; owners see/edit their own pets
create policy "pets_all_vet" on pets
  for all using (clinic_id = current_user_clinic_id());

create policy "pets_select_owner" on pets
  for select using (owner_id = auth.uid());

create policy "pets_update_owner" on pets
  for update using (owner_id = auth.uid());

-- caregivers: same visibility as the pet they're attached to
create policy "caregivers_all_vet" on caregivers
  for all using (
    pet_id in (select id from pets where clinic_id = current_user_clinic_id())
  );

create policy "caregivers_select_owner" on caregivers
  for select using (
    pet_id in (select id from pets where owner_id = auth.uid())
  );

-- medical_records: vet-authored and vet-editable; owners read-only
create policy "medical_records_all_vet" on medical_records
  for all using (clinic_id = current_user_clinic_id());

create policy "medical_records_select_owner" on medical_records
  for select using (
    pet_id in (select id from pets where owner_id = auth.uid())
  );

-- appointments: vets manage their clinic's; owners manage their own pet's
create policy "appointments_all_vet" on appointments
  for all using (clinic_id = current_user_clinic_id());

create policy "appointments_all_owner" on appointments
  for all using (
    pet_id in (select id from pets where owner_id = auth.uid())
  );

-- payments: vets manage their clinic's; owners read-only on their own
create policy "payments_all_vet" on payments
  for all using (clinic_id = current_user_clinic_id());

create policy "payments_select_owner" on payments
  for select using (owner_id = auth.uid());

-- ownership_transfers: either party to the transfer can see it;
-- only the initiating owner can insert, only the recipient can accept/decline
create policy "ownership_transfers_select_parties" on ownership_transfers
  for select using (from_owner_id = auth.uid() or to_owner_id = auth.uid());

create policy "ownership_transfers_insert_owner" on ownership_transfers
  for insert with check (from_owner_id = auth.uid());

create policy "ownership_transfers_update_recipient" on ownership_transfers
  for update using (to_owner_id = auth.uid());

create policy "ownership_transfers_all_vet" on ownership_transfers
  for all using (
    pet_id in (select id from pets where clinic_id = current_user_clinic_id())
  );
