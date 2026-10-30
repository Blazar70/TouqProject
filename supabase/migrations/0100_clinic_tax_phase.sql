-- Tax phase per clinic (user 2026-10-29), set by the Touq admin only:
-- * clinics.tax_phase: 'none' (not VAT-registered: no VAT, plain invoice, no QR) or
--   'phase1' (VAT number + ZATCA phase-1 QR, as before). 'phase2' (signed invoices sent
--   to ZATCA) is added with that work in v3. zatca_phase2_date = the date ZATCA gave the
--   clinic for phase 2 (its "wave"); stored only, nothing reads it yet.
-- * The VAT number moves from whole-clinic managers to the admin, with the phase.
-- * invoices.tax_phase = the clinic's phase when the invoice was made. On a 'none' invoice
--   every line's VAT rate and amount are 0: the owner pays the list price, none of it is VAT.
--   Done by triggers so every path through create_invoice() is covered.

alter table clinics
  add column tax_phase text not null default 'none' check (tax_phase in ('none', 'phase1')),
  add column zatca_phase2_date date;
update clinics set tax_phase = 'phase1' where vat_number is not null;
alter table clinics add constraint clinics_phase1_needs_vat_number check (tax_phase = 'none' or vat_number is not null);

-- 0076's guard; vat_number leaves the managers' list (tax_phase and the date were never on it).
create or replace function public.enforce_clinic_row_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_open text[] := array['name', 'phone', 'logo_url', 'max_staff_discount_percent'];
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
  if new.max_staff_discount_percent is distinct from old.max_staff_discount_percent
    and not public.current_user_is_clinic_manager() then
    raise exception 'Only a whole-clinic manager can change the discount limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

alter table invoices add column tax_phase text not null default 'phase1' check (tax_phase in ('none', 'phase1'));
update invoices i set tax_phase = c.tax_phase from clinics c where c.id = i.clinic_id;

create function public.invoices_take_tax_phase()
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
create trigger invoices_take_tax_phase before insert on invoices
  for each row execute function public.invoices_take_tax_phase();

create function public.invoice_items_no_vat_when_unregistered()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select tax_phase from invoices where id = new.invoice_id) = 'none' then
    new.vat_rate := 0;
    new.vat_amount := 0;
  end if;
  return new;
end;
$$;
create trigger invoice_items_no_vat_when_unregistered before insert on invoice_items
  for each row execute function public.invoice_items_no_vat_when_unregistered();
