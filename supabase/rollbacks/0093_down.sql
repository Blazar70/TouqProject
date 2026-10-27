-- Rollback for 0093_rebill_after_full_credit.sql. Links go back to the credited bill only where the
-- visit or stay was not billed again (the one-bill keys would refuse a second link).
drop trigger invoices_release_when_credited on invoices;
drop function public.invoices_release_when_credited();
update invoices i set appointment_id = i.credited_appointment_id
where i.credited_appointment_id is not null
  and not exists (select 1 from invoices o where o.appointment_id = i.credited_appointment_id);
update invoices i set stay_id = i.credited_stay_id
where i.credited_stay_id is not null
  and not exists (select 1 from invoices o where o.stay_id = i.credited_stay_id);
alter table invoices drop column credited_appointment_id, drop column credited_stay_id;
