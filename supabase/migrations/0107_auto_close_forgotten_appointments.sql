-- Touq / طوق — user 11-05: requested or confirmed appointments nobody updated for 3 days close themselves
-- every night. Arrived and in-session ones never do (the pet was there, so it may be an unbilled visit: the
-- Manager page lists them), nor does anything with visit work attached. A category of its own keeps the
-- Dashboard's no-show count honest: nobody checked that the pet stayed away.

create function public.auto_close_forgotten_appointments()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_total integer;
begin
  with closed as (
    update appointments a
    set status = 'cancelled', cancellation_category = 'auto_closed'
    where a.status in ('requested', 'confirmed')
      and a.scheduled_at < now() - interval '3 days'
      and not exists (select 1 from medical_records m where m.appointment_id = a.id)
      and not exists (select 1 from appointment_services s where s.appointment_id = a.id)
      and not exists (select 1 from invoices i where i.appointment_id = a.id or i.credited_appointment_id = a.id)
    returning a.clinic_id
  ), logged as (
    insert into admin_audit_log (actor_name, action, target_type, target_label, clinic_id)
    select 'Touq', 'appointments_auto_closed', 'appointment', count(*)::text, clinic_id
    from closed group by clinic_id
    returning 1
  )
  select coalesce(sum(target.n), 0) into v_total
  from (select count(*) as n from closed) target, (select count(*) from logged) forced;
  return v_total;
end;
$$;

revoke execute on function public.auto_close_forgotten_appointments() from public, anon, authenticated, service_role;

-- 03:15 UTC = 06:15 Riyadh, before clinics open and just after the 03:00 purge.
select cron.schedule('auto-close-forgotten-appointments', '15 3 * * *', 'select public.auto_close_forgotten_appointments()');
