-- Touq / طوق — repurpose `payments` from pet/owner billing (schema-only,
-- never had a UI — see 0034's note that owner accounts are effectively
-- unused) to clinic billing: this ledger now tracks each clinic's
-- payments to Touq for the software itself, so admins can see which
-- clinics have paid and which haven't. Drops the now-unused pet/owner
-- link and adds a place to attach the invoice/receipt PDF.

-- Clinic billing is admin-only bookkeeping, not something clinic staff
-- self-report — the old policies assumed a per-pet invoice a vet would
-- manage on their own clinic's behalf; drop them now that there's no
-- pet/owner left to scope by. payments_all_admin (0004b) still applies.
-- Must run before the column drops: payments_select_owner reads owner_id.
drop policy if exists "payments_all_vet" on payments;
drop policy if exists "payments_select_owner" on payments;

alter table payments drop column pet_id;
alter table payments drop column owner_id;
alter table payments add column document_path text;

-- Re-schedule without the payments cleanup line (0032) — payments no
-- longer reference pet_id, so there's nothing to clear before a purge.
select cron.schedule(
  'purge-trashed-pets-and-staff',
  '0 3 * * *',
  $$
  delete from pets where deleted_at is not null and deleted_at < now() - interval '7 days';
  update appointments set assigned_staff_id = null where assigned_staff_id in (
    select id from caregivers where deleted_at is not null and deleted_at < now() - interval '7 days'
  );
  delete from caregivers where deleted_at is not null and deleted_at < now() - interval '7 days';
  $$
);

-- Private bucket for payment documents (invoices/receipts) — unlike
-- pet-photos this is financial paperwork, so it stays non-public and
-- admin-only, served via signed URLs instead of a public CDN URL.
insert into storage.buckets (id, name, public)
values ('payment-documents', 'payment-documents', false);

create policy "payment_documents_all_admin" on storage.objects
  for all to authenticated
  using (bucket_id = 'payment-documents' and current_user_is_admin())
  with check (bucket_id = 'payment-documents' and current_user_is_admin());
