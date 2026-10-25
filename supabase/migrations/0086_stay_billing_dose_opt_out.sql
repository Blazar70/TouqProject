-- Touq / طوق — phase 6 finish (user decisions 2026-10-25).
-- 1. Bill a hospital stay: a manager marks one price-list service as the hospital night
--    (services.hospital_night, one per clinic). "Bill this stay" opens Payments with
--    "<night service> × nights"; the rest is added by hand. invoices.stay_id links the bill to
--    the stay (unique: billed once). create_invoice gets p_stay (0062 body otherwise unchanged).
-- 2. Dose reminder push opt-out per person (profiles.inpatient_dose_push, on by default);
--    send-appointment-reminders skips people who turned it off.

alter table services add column hospital_night boolean not null default false;
create unique index services_one_hospital_night on services (clinic_id) where hospital_night;

alter table invoices add column stay_id uuid references inpatient_stays (id) on delete set null;
alter table invoices add constraint invoices_stay_id_key unique (stay_id);

alter table profiles add column inpatient_dose_push boolean not null default true;

-- New argument = new signature: drop the old one so calls without p_stay aren't ambiguous.
drop function public.create_invoice(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, timestamptz);

create function public.create_invoice(
  p_pet uuid,
  p_branch uuid,
  p_appointment uuid,
  p_notes text,
  p_lines jsonb,
  p_discount jsonb,
  p_payments jsonb,
  p_paid_at timestamptz default now(),
  p_stay uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_clinic uuid := public.current_user_clinic_id();
  v_max numeric;
  v_line jsonb;
  v_pay jsonb;
  v_unit numeric;
  v_qty integer;
  v_rate numeric;
  v_gross numeric;
  v_disc numeric;
  v_n integer := 0;
  v_after numeric[] := '{}';
  v_line_disc numeric[] := '{}';
  v_units numeric[] := '{}';
  v_rates numeric[] := '{}';
  v_share numeric[] := '{}';
  v_sum numeric := 0;
  v_bill numeric;
  v_big integer := 1;
  v_vat numeric;
  v_vat_total numeric := 0;
  v_paid numeric := 0;
  v_id uuid;
  v_branch uuid;
  i integer;
begin
  if v_clinic is null then
    raise exception 'Only clinic staff can create invoices' using errcode = '42501';
  end if;
  if not exists (select 1 from pets where id = p_pet and clinic_id = v_clinic) then
    raise exception 'Choose a pet' using errcode = 'P0001';
  end if;
  if p_appointment is not null and not exists (select 1 from appointments where id = p_appointment and clinic_id = v_clinic and pet_id = p_pet) then
    raise exception 'That appointment is not this pet''s' using errcode = 'P0001';
  end if;
  -- 0086: a stay is billed once (invoices_stay_id_key), after discharge.
  if p_stay is not null and not exists (select 1 from inpatient_stays where id = p_stay and clinic_id = v_clinic and pet_id = p_pet and discharged_at is not null) then
    raise exception 'That stay is not this pet''s or is still open' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then
    raise exception 'Add at least one item' using errcode = 'P0001';
  end if;

  -- Managers: any discount. Everyone else: up to the clinic's limit.
  select case when public.current_user_has_role(array['manager']) then null else max_staff_discount_percent end
    into v_max from clinics where id = v_clinic;

  -- Pass 1: each line after its own discount.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_unit := (v_line->>'unit_price')::numeric;
    v_qty := (v_line->>'quantity')::integer;
    if coalesce(btrim(v_line->>'description'), '') = '' or v_unit is null or v_unit < 0 or v_qty is null or v_qty <= 0 then
      raise exception 'Add at least one item with a valid price' using errcode = 'P0001';
    end if;
    v_rate := 15;
    if nullif(v_line->>'service_id', '') is not null then
      -- The list price (incl. VAT, same rounding as priceWithVat in src/lib/vat.ts), not what the client sent.
      select vat_rate, round(price * (1 + vat_rate / 100), 2) into v_rate, v_unit
        from services where id = (v_line->>'service_id')::uuid and clinic_id = v_clinic;
      if not found then
        raise exception 'Pick a service from this clinic''s price list' using errcode = 'P0001';
      end if;
    end if;
    v_units := v_units || v_unit;
    v_gross := round(v_unit * v_qty, 2);
    v_disc := public.invoice_discount(v_gross, v_line->'discount', v_max);
    v_n := v_n + 1;
    v_after := v_after || (v_gross - v_disc);
    v_line_disc := v_line_disc || v_disc;
    v_rates := v_rates || v_rate;
    v_sum := v_sum + v_gross - v_disc;
    if v_gross - v_disc > v_after[v_big] then v_big := v_n; end if;
  end loop;

  -- Whole-bill discount, spread over the lines by amount.
  v_bill := case when p_discount is null or jsonb_typeof(p_discount) = 'null' then 0
                 else public.invoice_discount(v_sum, p_discount, v_max) end;
  for i in 1..v_n loop
    v_share := v_share || case when v_sum = 0 then 0 else round(v_bill * v_after[i] / v_sum, 2) end;
  end loop;
  v_share[v_big] := v_share[v_big] + v_bill - (select coalesce(sum(s), 0) from unnest(v_share) s);

  for i in 1..v_n loop
    v_vat_total := v_vat_total + round((v_after[i] - v_share[i]) * v_rates[i] / (100 + v_rates[i]), 2);
  end loop;

  insert into invoices (clinic_id, pet_id, appointment_id, stay_id, branch_id, created_by, notes, amount_total, vat_total,
                        discount_type, discount_value, discount_amount, discount_reason)
  values (v_clinic, p_pet, p_appointment, p_stay, p_branch, auth.uid(), nullif(btrim(p_notes), ''), v_sum - v_bill, v_vat_total,
          case when v_bill > 0 then p_discount->>'type' end,
          case when v_bill > 0 then (p_discount->>'value')::numeric end,
          v_bill,
          case when v_bill > 0 then btrim(p_discount->>'reason') end)
  returning id, branch_id into v_id, v_branch;

  i := 0;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into invoice_items (invoice_id, position, service_id, description, unit_price, quantity, vat_rate,
                               discount_type, discount_value, discount_amount, discount_reason,
                               line_total, bill_discount_share, vat_amount)
    values (v_id, i, nullif(v_line->>'service_id', '')::uuid, btrim(v_line->>'description'),
            v_units[i], (v_line->>'quantity')::integer, v_rates[i],
            case when v_line_disc[i] > 0 then v_line->'discount'->>'type' end,
            case when v_line_disc[i] > 0 then (v_line->'discount'->>'value')::numeric end,
            v_line_disc[i],
            case when v_line_disc[i] > 0 then btrim(v_line->'discount'->>'reason') end,
            v_after[i], v_share[i],
            round((v_after[i] - v_share[i]) * v_rates[i] / (100 + v_rates[i]), 2));
  end loop;

  for v_pay in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_paid := v_paid + (v_pay->>'amount')::numeric;
    insert into invoice_payments (invoice_id, clinic_id, branch_id, method, amount, paid_at, received_by)
    values (v_id, v_clinic, v_branch, v_pay->>'method', (v_pay->>'amount')::numeric, coalesce(p_paid_at, now()), auth.uid());
  end loop;
  if v_paid > v_sum - v_bill then
    raise exception 'The payments are more than the invoice total' using errcode = 'P0001';
  end if;

  perform public.refresh_invoice_status(v_id);
  return v_id;
end;
$$;
