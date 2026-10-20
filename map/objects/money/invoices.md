---
type: object
cluster: money
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0037_service_payments.sql
---

# Invoices and invoice items

What a pet owner paid the clinic for a visit or items. Product word "payment" on the clinic's Payments page.

## Why this shape

Items copy `description` and `unit_price` from the service at sale time, so a later price edit does not rewrite history (0037 comment).

## Shape

- `invoices`: `clinic_id`, `pet_id` (cascade), `appointment_id` (set null), `method` cash/card/apple_pay, `status` recorded/verified, `amount_total`, `paid_at`, `verified_by`, `verified_at`
- Cash is verified immediately on entry; card and Apple Pay start as `recorded` and are verified by staff against the terminal slip. `src/pages/PaymentsPage.tsx:181-197`
- `invoice_items`: `invoice_id` (cascade), `service_id` (set null), `description`, `unit_price`, `quantity`, `line_total`
- `branch_id` not null (0046), main branch filled by trigger `fill_default_branch()` when not sent. See [branches](../people/branches.md).
- Policies: vet by clinic, admin all.

## Connected to

- **owned-by:** clinics, pets
- **joins:** appointments, services, profiles (created_by, verified_by)
- **looks-like-but-is-not:** payments

## If you change this

- **Hits:** `PaymentsPage` and its daily totals, CSV export (`src/lib/csvExport.ts`), `PrintContext`.
- **Does not hit:** AdminBillingPage.

## See

- Source: `src/lib/database.types.ts:282, 237`
