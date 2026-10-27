-- Touq / طوق — nightly 10-26 B16 (user 10-27: allow a new bill once the old one is fully credited).
-- A visit or stay has one bill (invoices_appointment_id_key, invoices_stay_id_key). When credit notes
-- cover a bill's whole total, its link moves to credited_appointment_id / credited_stay_id: the visit
-- or stay counts as unbilled again (billed(), the visit-services lock, "Bill this stay"), and the old
-- bill still records what it was for. A partly credited bill keeps blocking a second one.

alter table invoices
  add column credited_appointment_id uuid references appointments (id) on delete set null,
  add column credited_stay_id uuid references inpatient_stays (id) on delete set null;

create function public.invoices_release_when_credited()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- amount_total > 0: a free (0.00) bill is never "fully credited".
  if new.amount_total > 0 and new.amount_credited >= new.amount_total then
    if new.appointment_id is not null then
      new.credited_appointment_id := new.appointment_id;
      new.appointment_id := null;
    end if;
    if new.stay_id is not null then
      new.credited_stay_id := new.stay_id;
      new.stay_id := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_release_when_credited
before update of amount_credited on invoices
for each row execute function public.invoices_release_when_credited();

-- Bills already fully credited before today.
update invoices set amount_credited = amount_credited
where amount_total > 0 and amount_credited >= amount_total and (appointment_id is not null or stay_id is not null);
