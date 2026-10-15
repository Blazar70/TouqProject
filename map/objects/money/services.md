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

- `clinic_id`, `name`, `price` (>= 0, PRE-VAT, 4 decimals since `0041_services_price_precision.sql`), `vat_rate` (0–100, default 15 = Saudi VAT; added in `0039_services_vat.sql`), `active`
- Post-VAT price is not stored: derived as `price * (1 + vat_rate/100)` rounded to halalas (`src/lib/vat.ts`). SettingsPage lets staff type pre- or post-VAT; the other is calculated, and the saved pre-VAT price is derived from the post-VAT one so the post-VAT price round-trips exactly.
- Managed on SettingsPage, read (active only) on PaymentsPage. `src/pages/PaymentsPage.tsx:83`
- `invoice_items.service_id` is set null if a service is deleted; deactivating keeps names readable.

## Connected to

- **owned-by:** clinics
- **joins:** invoice_items.service_id

## If you change this

- **Hits:** SettingsPage, PaymentsPage service picker (still uses `price`, i.e. pre-VAT; VAT on invoices is a later phase).
- **Does not hit:** existing invoice amounts (copied at sale time).

## Fixed 2026-10-14

`purgeClinic` did not delete `services`, and `services.clinic_id` has no cascade, so the final clinic delete would hit a foreign-key error. It now deletes `invoices` and `services` before pets (`supabase/functions/admin-manage-clinic/index.ts`, search `purgeClinic`). Deployed to the live project the same day (default JWT verification on); not exercised with a real purge.

## See

- Source: `src/lib/database.types.ts:713`
