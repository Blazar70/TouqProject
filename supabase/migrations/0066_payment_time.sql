-- 0066: who decides a payment's time.
-- Staff can't choose it: a payment is timed when it is recorded (Create invoice /
-- Add payment). Managers may enter an earlier time for a late entry, never a
-- future one. Enforced on the table, so every insert path obeys it.
-- created_at keeps the real entry time either way.

create function public.enforce_payment_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.paid_at is null or not public.current_user_has_role(array['manager']) then
    new.paid_at := now();
  elsif new.paid_at > now() + interval '5 minutes' then
    raise exception 'A payment time can''t be in the future' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger invoice_payments_enforce_time
  before insert on invoice_payments
  for each row execute function public.enforce_payment_time();

-- Same as 0061 plus p_paid_at (managers only; the trigger ignores it for others).
drop function public.add_invoice_payment(uuid, text, numeric, uuid);
create function public.add_invoice_payment(
  p_invoice uuid,
  p_method text,
  p_amount numeric,
  p_branch uuid default null,
  p_paid_at timestamptz default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
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

notify pgrst, 'reload schema';
