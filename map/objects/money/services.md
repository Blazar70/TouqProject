---
type: object
cluster: money
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0037_service_payments.sql
---

# Services

A clinic's own price list.

## Shape

- `clinic_id`, `name`, `price` (>= 0), `active`
- Managed on SettingsPage, read (active only) on PaymentsPage. `src/pages/PaymentsPage.tsx:83`
- `invoice_items.service_id` is set null if a service is deleted; deactivating keeps names readable.

## Connected to

- **owned-by:** clinics
- **joins:** invoice_items.service_id

## If you change this

- **Hits:** SettingsPage, PaymentsPage service picker.
- **Does not hit:** existing invoice amounts (copied at sale time).

## Fixed 2026-10-14

`purgeClinic` did not delete `services`, and `services.clinic_id` has no cascade, so the final clinic delete would hit a foreign-key error. It now deletes `invoices` and `services` before pets (`supabase/functions/admin-manage-clinic/index.ts`, search `purgeClinic`). Deployed to the live project the same day (default JWT verification on); not exercised with a real purge.

## See

- Source: `src/lib/database.types.ts:713`
