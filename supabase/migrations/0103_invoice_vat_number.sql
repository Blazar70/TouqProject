-- The VAT number on each invoice (nightly B30): a reprint shows the number the invoice was issued with, not the
-- clinic's current one, so the admin correcting or clearing it (back to "not registered") never rewrites old
-- tax invoices. Credit notes print with their invoice's number. Filled by 0100's insert trigger; clients can
-- only read invoices (0099), so nobody changes it afterwards.

alter table invoices add column vat_number text;
update invoices i set vat_number = c.vat_number from clinics c where c.id = i.clinic_id and i.tax_phase = 'phase1';

create or replace function public.invoices_take_tax_phase()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  select tax_phase, case when tax_phase = 'phase1' then vat_number end into new.tax_phase, new.vat_number
    from clinics where id = new.clinic_id;
  if new.tax_phase = 'none' then
    new.vat_total := 0;
  end if;
  return new;
end;
$$;
