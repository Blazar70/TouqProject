-- Undo 0103: 0100's trigger function as it was, then the column.

create or replace function public.invoices_take_tax_phase()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  select tax_phase into new.tax_phase from clinics where id = new.clinic_id;
  if new.tax_phase = 'none' then
    new.vat_total := 0;
  end if;
  return new;
end;
$$;

alter table invoices drop column vat_number;
