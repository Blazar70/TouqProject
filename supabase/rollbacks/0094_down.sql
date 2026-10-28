-- Rollback for 0094_unpaid_skips_credited_visits.sql: report_unpaid as in 0069.
create or replace function public.report_unpaid(p_branch uuid default null, p_from date default null, p_to date default null)
returns table (kind text, id uuid, at timestamptz, branch_id uuid, invoice_number text, pet_name text, pet_number integer,
               owner_name text, owner_phone text, doctor_name text, total numeric, paid numeric, remaining numeric)
language sql stable security invoker
set search_path = public
as $$
  with c as (select * from public.report_bounds(coalesce(p_from, '1900-01-01'), coalesce(p_to, '2999-12-31'))),
  r as (
    select 'visit' as kind, a.id, a.scheduled_at as at, a.branch_id, null::text as invoice_number, a.pet_id, null::text as inv_pet_name, null::integer as inv_pet_number, a.doctor_id,
           coalesce(s.total, 0) as total, 0::numeric as paid
    from appointments a join c on a.clinic_id = c.clinic_id and a.scheduled_at >= c.t0 and a.scheduled_at < c.t1
    left join lateral (
      select sum(round(round(x.unit_price * (1 + x.vat_rate / 100), 2) * x.quantity, 2)) as total
      from appointment_services x where x.appointment_id = a.id
    ) s on true
    where a.status = 'completed' and not exists (select 1 from invoices i where i.appointment_id = a.id)
    union all
    select 'invoice', i.id, i.created_at, i.branch_id, i.invoice_number, i.pet_id, i.pet_name, i.pet_number, a.doctor_id,
           i.amount_total - i.amount_credited, i.amount_paid - i.amount_refunded
    from invoices i join c on i.clinic_id = c.clinic_id and i.created_at >= c.t0 and i.created_at < c.t1
    left join appointments a on a.id = i.appointment_id
    where i.payment_status <> 'paid'
  )
  select r.kind, r.id, r.at, r.branch_id, r.invoice_number, coalesce(p.name, r.inv_pet_name), coalesce(p.pet_number, r.inv_pet_number), p.owner_name, p.owner_phone, d.full_name,
         r.total, r.paid, r.total - r.paid
  from r left join pets p on p.id = r.pet_id
  left join profiles d on d.id = r.doctor_id
  where p_branch is null or r.branch_id = p_branch
  order by r.at, r.kind;
$$;

notify pgrst, 'reload schema';
