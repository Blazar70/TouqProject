-- Explicit table grants (nightly S18). From 30 Oct 2026 Supabase stops giving new public tables to the API roles
-- automatically; until now every table here got its access from default privileges (Supabase's own + 0005).
-- Live is still at 0046, so tables made by 0047+ on live would come up with no access at all.
-- This states, per table, exactly the access staging has on 10-29 (read from information_schema.role_table_grants),
-- so the chain works with or without the old defaults. Deliberate limits stay: tables missing an action here had
-- it revoked on purpose (e.g. 0061 invoices, 0063 owner_files use column grants), and the two number counters get
-- nothing. anon is left out: Touq never reads tables before sign-in.
-- New table from now on: add its grant in its own migration.

grant select on table
  public.credit_notes,
  public.invoice_items,
  public.invoice_payments,
  public.invoices,
  public.owner_balance_entries,
  public.owner_balances,
  public.owner_files,
  public.vaccine_doses
  to authenticated;

grant select, insert on table
  public.cash_counts
  to authenticated;

grant select, insert, delete on table
  public.inpatient_stays,
  public.inpatient_task_doses,
  public.inpatient_tasks,
  public.inpatient_updates,
  public.owner_reminders_sent,
  public.pet_waivers,
  public.waiver_templates
  to authenticated;

grant select, insert, update, delete on table
  public.admin_audit_log,
  public.appointment_reminders_sent,
  public.appointment_services,
  public.appointments,
  public.branches,
  public.clinics,
  public.doctor_time_off,
  public.inpatient_task_alerts_sent,
  public.medical_records,
  public.ownership_transfers,
  public.payments,
  public.pet_trusted_contacts,
  public.pet_vaccines,
  public.pets,
  public.profiles,
  public.push_subscriptions,
  public.services,
  public.staff_branches,
  public.vaccines,
  public.visit_templates
  to authenticated;

grant select, insert, update, delete on table
  public.admin_audit_log,
  public.appointment_reminders_sent,
  public.appointment_services,
  public.appointments,
  public.branches,
  public.cash_counts,
  public.clinics,
  public.credit_notes,
  public.doctor_time_off,
  public.inpatient_stays,
  public.inpatient_task_alerts_sent,
  public.inpatient_task_doses,
  public.inpatient_tasks,
  public.inpatient_updates,
  public.invoice_counters,
  public.invoice_items,
  public.invoice_payments,
  public.invoices,
  public.medical_records,
  public.owner_balance_entries,
  public.owner_balances,
  public.owner_files,
  public.owner_reminders_sent,
  public.ownership_transfers,
  public.payments,
  public.pet_number_counters,
  public.pet_trusted_contacts,
  public.pet_vaccines,
  public.pet_waivers,
  public.pets,
  public.profiles,
  public.push_subscriptions,
  public.services,
  public.staff_branches,
  public.vaccine_doses,
  public.vaccines,
  public.visit_templates,
  public.waiver_templates
  to service_role;
