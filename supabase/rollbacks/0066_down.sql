-- Rollback for 0066_payment_time.sql. Payment rows are untouched.
drop trigger if exists invoice_payments_enforce_time on invoice_payments;
drop function if exists public.enforce_payment_time();

drop function if exists public.add_invoice_payment(uuid, text, numeric, uuid, timestamptz);
create function public.add_invoice_payment(p_invoice uuid, p_method text, p_amount numeric, p_branch uuid default null)
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
  insert into invoice_payments (invoice_id, clinic_id, branch_id, method, amount, received_by)
  values (p_invoice, v_inv.clinic_id, coalesce(p_branch, v_inv.branch_id), p_method, round(p_amount, 2), auth.uid());
  perform public.refresh_invoice_status(p_invoice);
end;
$$;

notify pgrst, 'reload schema';
