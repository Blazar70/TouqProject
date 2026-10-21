---
type: object
cluster: money
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0035_clinic_billing_payments.sql
---

# Payments (clinic billing to Touq)

What a clinic pays Touq for the software. Admin-only bookkeeping.

## Why this shape

Despite the name, this is NOT what pet owners pay. 0001 made `payments` a pet/owner invoice table; 0035 repurposed it to clinic-to-Touq billing and dropped `pet_id`/`owner_id`. Pet-owner payments live in `invoices` (0037).

## Shape

- `clinic_id`, `amount`, `status` pending/paid/overdue/cancelled, `due_date`, `paid_at`, `document_path` (0035)
- Documents are stored in the private bucket `payment-documents`, admin-only, signed URLs.
- Only the admin policy applies. The vet and owner policies were dropped in 0035.

## Connected to

- **owned-by:** clinics

## If you change this

- **Hits:** `src/pages/AdminBillingPage.tsx`, the admin dashboard "Billing due" panel (`src/lib/billingDue.ts`: pending/overdue and marked overdue, past due, or due within 7 days), payment-documents bucket, `admin-manage-clinic` purge.
- **Does not hit:** invoices, services, `PaymentsPage` (that page is clinic-side invoices).

## Surfaces

| Surface | Role |
|---|---|
| AdminBillingPage | read/write, upload document |

## See

- Source: `src/lib/database.types.ts:492`
