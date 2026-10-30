-- Undo 0100: no tax phase; managers edit the VAT number again (0076's guard).
drop trigger invoice_items_no_vat_when_unregistered on invoice_items;
drop function public.invoice_items_no_vat_when_unregistered();
drop trigger invoices_take_tax_phase on invoices;
drop function public.invoices_take_tax_phase();
alter table invoices drop column tax_phase;

create or replace function public.enforce_clinic_row_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_open text[] := array['name', 'phone', 'logo_url', 'vat_number', 'max_staff_discount_percent'];
begin
  if auth.role() is not distinct from 'service_role' or auth.uid() is null or public.current_user_is_admin() then
    return new;
  end if;
  if (to_jsonb(new) - v_open) is distinct from (to_jsonb(old) - v_open) then
    raise exception 'only an admin may change this clinic setting';
  end if;
  if (new.name, new.phone, new.logo_url) is distinct from (old.name, old.phone, old.logo_url)
    and not public.current_user_has_role(array['manager']) then
    raise exception 'Only managers can change the clinic info' using errcode = 'P0001';
  end if;
  if (new.vat_number, new.max_staff_discount_percent) is distinct from (old.vat_number, old.max_staff_discount_percent)
    and not public.current_user_is_clinic_manager() then
    raise exception 'Only a whole-clinic manager can change the VAT number or discount limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

alter table clinics drop constraint clinics_phase1_needs_vat_number;
alter table clinics drop column zatca_phase2_date, drop column tax_phase;
