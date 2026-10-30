-- Undo 0102: the four money functions without p_request (as before), then the request_id columns.

drop function public.create_invoice(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, timestamp with time zone, uuid, uuid);
create or replace function public.create_invoice(p_pet uuid, p_branch uuid, p_appointment uuid, p_notes text, p_lines jsonb, p_discount jsonb, p_payments jsonb, p_paid_at timestamp with time zone DEFAULT now(), p_stay uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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

drop function public.add_invoice_payment(uuid, text, numeric, uuid, timestamp with time zone, uuid);
create or replace function public.add_invoice_payment(p_invoice uuid, p_method text, p_amount numeric, p_branch uuid DEFAULT NULL::uuid, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_inv invoices;
begin
  select * into v_inv from invoices where id = p_invoice and clinic_id = public.current_user_clinic_id() for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0
    or p_amount > v_inv.amount_total - v_inv.amount_credited - (v_inv.amount_paid - v_inv.amount_refunded) then
    raise exception 'Enter an amount up to what is still owed' using errcode = 'P0001';
  end if;
  insert into invoice_payments (invoice_id, clinic_id, branch_id, method, amount, paid_at, received_by)
  values (p_invoice, v_inv.clinic_id, coalesce(p_branch, v_inv.branch_id), p_method, round(p_amount, 2), p_paid_at, auth.uid());
  perform public.refresh_invoice_status(p_invoice);
end;
$$;

drop function public.add_owner_balance(uuid, numeric, text, text, uuid, uuid);
create or replace function public.add_owner_balance(p_owner uuid, p_amount numeric, p_method text, p_reason text DEFAULT NULL::text, p_branch uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_owner owner_files;
  v_id uuid;
  v_kind text := case when p_method is null then 'adjustment' else 'top_up' end;
begin
  if not public.current_user_has_role(case when v_kind = 'top_up' then array['manager', 'receptionist'] else array['manager'] end) then
    raise exception 'Only receptionists and managers can add balance' using errcode = '42501';
  end if;
  select * into v_owner from owner_files where id = p_owner and clinic_id = public.current_user_clinic_id();
  if not found then
    raise exception 'Owner not found' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount = 0 or (v_kind = 'top_up' and (p_amount < 0 or p_method not in ('cash', 'card', 'apple_pay'))) then
    raise exception 'Enter an amount' using errcode = 'P0001';
  end if;
  if v_kind = 'adjustment' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'An adjustment needs a reason' using errcode = 'P0001';
  end if;
  if p_branch is not null and not exists (select 1 from branches where id = p_branch and clinic_id = v_owner.clinic_id) then
    raise exception 'Pick a branch of this clinic' using errcode = 'P0001';
  end if;

  insert into owner_balance_entries (clinic_id, owner_file_id, kind, amount, method, reason, branch_id, created_by)
  values (v_owner.clinic_id, p_owner, v_kind, round(p_amount, 2), p_method, nullif(btrim(p_reason), ''), p_branch, auth.uid())
  returning id into v_id;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), case when v_kind = 'top_up' then 'balance_top_up' else 'balance_adjusted' end,
         'owner', v_owner.name || ' · ' || round(p_amount, 2) || ' · ' || coalesce(p_method, btrim(p_reason)), v_owner.clinic_id
  from (select 1) one left join profiles p on p.id = auth.uid();
  return v_id;
end;
$$;

drop function public.create_credit_note(uuid, uuid[], numeric, text, text, uuid);
create or replace function public.create_credit_note(p_invoice uuid, p_item_ids uuid[], p_amount numeric, p_reason text, p_refund_method text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_inv invoices;
  v_base numeric;
  v_base_vat numeric;
  v_amount numeric;
  v_owed numeric;
  v_id uuid;
begin
  select * into v_inv from invoices where id = p_invoice and clinic_id = public.current_user_clinic_id() for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A credit note needs a reason' using errcode = 'P0001';
  end if;

  if coalesce(cardinality(p_item_ids), 0) > 0 then
    if (select count(*) from invoice_items where invoice_id = p_invoice and id = any (p_item_ids)) <> cardinality(p_item_ids) then
      raise exception 'Pick lines from this invoice' using errcode = 'P0001';
    end if;
    if exists (select 1 from credit_notes where invoice_id = p_invoice and item_ids && p_item_ids) then
      raise exception 'One of these lines is already credited' using errcode = 'P0001';
    end if;
    select sum(line_total - bill_discount_share), sum(vat_amount) into v_base, v_base_vat
    from invoice_items where id = any (p_item_ids);
  else
    -- What is left, and the VAT still in it.
    v_base := v_inv.amount_total - v_inv.amount_credited;
    v_base_vat := v_inv.vat_total - coalesce((select sum(vat_amount) from credit_notes where invoice_id = p_invoice), 0);
  end if;

  v_amount := round(coalesce(p_amount, v_base), 2);
  if v_amount <= 0 or v_amount > v_base or v_amount > v_inv.amount_total - v_inv.amount_credited then
    raise exception 'A credit note can''t be more than what is left on the invoice' using errcode = 'P0001';
  end if;

  v_owed := greatest(v_inv.amount_total - v_inv.amount_credited - (v_inv.amount_paid - v_inv.amount_refunded), 0);
  insert into credit_notes (clinic_id, invoice_id, branch_id, item_ids, amount, vat_amount, reason, refund_method, refund_amount, created_by)
  values (v_inv.clinic_id, p_invoice, v_inv.branch_id, coalesce(p_item_ids, '{}'), v_amount,
          case when v_base = 0 then 0 else round(v_amount * v_base_vat / v_base, 2) end,
          btrim(p_reason), p_refund_method, greatest(v_amount - v_owed, 0), auth.uid())
  returning id into v_id;

  perform public.refresh_invoice_status(p_invoice);
  return v_id;
end;
$$;

alter table public.invoices drop column request_id;
alter table public.invoice_payments drop column request_id;
alter table public.owner_balance_entries drop column request_id;
alter table public.credit_notes drop column request_id;
