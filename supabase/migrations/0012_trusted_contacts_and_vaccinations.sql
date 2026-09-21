-- Touq / طوق — trusted contacts (people other than the owner who can bring
-- the pet to appointments) and vaccination scheduling.

create table pet_trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references pets (id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

alter table pet_trusted_contacts enable row level security;

grant select, insert, update, delete on pet_trusted_contacts to anon, authenticated, service_role;

create policy "pet_trusted_contacts_all_vet" on pet_trusted_contacts
  for all using (
    pet_id in (select id from pets where clinic_id = current_user_clinic_id())
  );

-- Vaccination scheduling: the clinic sets a due date and a repeat interval;
-- next_vaccination_date is recomputed (due date + interval) each time a dose
-- is marked given, rather than tracking a full dose history table — simpler
-- for a v1 and matches what a traffic-light badge actually needs to show.
alter table pets add column next_vaccination_date date;
alter table pets add column vaccination_interval_days integer;
