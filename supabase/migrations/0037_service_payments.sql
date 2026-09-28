-- Touq / طوق — clinic-facing payment tracking: a clinic's own price list
-- (services) and a ledger of what pet owners have paid (invoices +
-- invoice_items), separate from the `payments` table, which is admin-only
-- clinic-to-Touq subscription billing (see 0035).

create table services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  name text not null,
  price numeric(10, 2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- appointment_id is optional — a payment doesn't have to be tied to a
-- scheduled visit (e.g. a retail item, a walk-in extra).
--
-- status starts 'recorded' for every method, then card/apple_pay payments
-- move to 'verified' once staff cross-checks the amount/time against the
-- paper terminal slip; cash has no separate paper trail to check against,
-- so the UI marks it 'verified' immediately on entry. verified_by/at are
-- who did that check and when, kept separate from created_by/created_at
-- (who first recorded it) so the two steps have their own audit trail.
create table invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  pet_id uuid not null references pets (id) on delete cascade,
  appointment_id uuid references appointments (id) on delete set null,
  created_by uuid not null references profiles (id),
  method text not null check (method in ('cash', 'card', 'apple_pay')),
  status text not null default 'recorded' check (status in ('recorded', 'verified')),
  amount_total numeric(10, 2) not null check (amount_total >= 0),
  paid_at timestamptz not null default now(),
  notes text,
  verified_by uuid references profiles (id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index invoices_clinic_paid_at_idx on invoices (clinic_id, paid_at desc);

-- Line items so one invoice can bundle several services (or a one-off
-- custom charge with service_id left null). unit_price/description are
-- copied from the service at sale time rather than joined live, so a
-- later price change on the service doesn't retroactively change old
-- invoices.
create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  service_id uuid references services (id) on delete set null,
  description text not null,
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  quantity integer not null default 1 check (quantity > 0),
  line_total numeric(10, 2) not null check (line_total >= 0)
);

alter table services enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;

create policy "services_all_vet" on services
  for all using (clinic_id = current_user_clinic_id());

create policy "services_all_admin" on services
  for all using (current_user_is_admin());

create policy "invoices_all_vet" on invoices
  for all using (clinic_id = current_user_clinic_id());

create policy "invoices_all_admin" on invoices
  for all using (current_user_is_admin());

-- invoice_items: same visibility as the invoice it belongs to (same
-- pattern as caregivers scoping through their pet, see 0001).
create policy "invoice_items_all_vet" on invoice_items
  for all using (
    invoice_id in (select id from invoices where clinic_id = current_user_clinic_id())
  );

create policy "invoice_items_all_admin" on invoice_items
  for all using (current_user_is_admin());
