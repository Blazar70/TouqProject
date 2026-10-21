-- Touq / طوق — services per appointment + "bill this visit" (decided 2026-10-22).
--
-- Staff add services from the clinic's price list to a visit (session page,
-- appointment dialog). Name, pre-VAT price and VAT rate are copied from the
-- price list by the database at insert time, so the client can't set a price
-- and a later price edit doesn't change the visit. Only quantity is editable.
-- A visit is billed when an invoice points at it (invoices.appointment_id,
-- now one invoice per appointment); from then on its services are locked.

create table appointment_services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  appointment_id uuid not null references appointments (id) on delete cascade,
  service_id uuid references services (id) on delete set null,
  description text not null,
  unit_price numeric(12, 4) not null check (unit_price >= 0), -- pre-VAT, like services.price
  vat_rate numeric(5, 2) not null,
  quantity integer not null default 1 check (quantity > 0),
  added_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index appointment_services_appointment_idx on appointment_services (appointment_id);

-- Nulls stay allowed (payments without a visit); a plain unique constraint
-- also lets PostgREST embed an appointment's invoice as one object.
alter table invoices add constraint invoices_appointment_id_key unique (appointment_id);

-- security definer: the lock and the price copy must not depend on what the
-- caller can see. Clinic isolation is still RLS: clinic_id comes from the
-- appointment, and the policy's check rejects another clinic's appointment.
create function public.appointment_services_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_appointment uuid := case when tg_op = 'DELETE' then old.appointment_id else new.appointment_id end;
begin
  -- The appointment itself is being deleted (cascade, clinic purge): let its rows go.
  if tg_op = 'DELETE' and not exists (select 1 from appointments where id = v_appointment) then
    return old;
  end if;

  if exists (select 1 from invoices where appointment_id = v_appointment) then
    raise exception 'This visit is already billed; its services are locked' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if (new.clinic_id, new.appointment_id, new.service_id, new.description, new.unit_price, new.vat_rate, new.added_by, new.created_at)
       is distinct from (old.clinic_id, old.appointment_id, old.service_id, old.description, old.unit_price, old.vat_rate, old.added_by, old.created_at) then
      raise exception 'Only the quantity of a visit service can change' using errcode = 'P0001';
    end if;
    return new;
  end if;

  select a.clinic_id, s.name, s.price, s.vat_rate
    into new.clinic_id, new.description, new.unit_price, new.vat_rate
  from appointments a
  join services s on s.clinic_id = a.clinic_id and s.active
  where a.id = new.appointment_id and s.id = new.service_id;
  if not found then
    raise exception 'Pick a service from this clinic''s price list' using errcode = 'P0001';
  end if;
  new.added_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

create trigger appointment_services_guard
  before insert or update or delete on appointment_services
  for each row execute function public.appointment_services_guard();

alter table appointment_services enable row level security;

create policy "appointment_services_all_vet" on appointment_services
  for all using (clinic_id = (select current_user_clinic_id()));

create policy "appointment_services_all_admin" on appointment_services
  for all using (current_user_is_admin());
