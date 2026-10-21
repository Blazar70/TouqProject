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
- `branch_id` not null (0046), the Payments page sends the picked branch (phase 3); trigger `fill_default_branch()` fills main only when none is sent. List defaults to the picked branch, managers can switch. See [branches](../people/branches.md).
- Policies: vet by clinic, admin all.
- One invoice per appointment: unique `appointment_id` (0059). An invoice linked to a visit = the visit is billed; the calendar shows "Unpaid" on completed visits without one (`AppointmentsPage`, embed `invoice:invoices(id, status)`).

## Visit services (0059)

- `appointment_services`: `appointment_id` (cascade), `service_id` (set null), `description`, `unit_price` (pre-VAT, 4 dp), `vat_rate`, `quantity`, `clinic_id`, `added_by`. Policies: vet by clinic, admin all.
- Trigger `appointment_services_guard()` copies name/price/VAT/clinic from the price list on insert (client values ignored), lets only `quantity` change, and refuses any insert/update/delete once an invoice links the appointment. `supabase/migrations/0059_visit_services.sql`, check `supabase/tests/0059_visit_services_check.sql`.
- UI: `src/components/VisitServices.tsx` on SessionPage and the completed-appointment dialog. "Bill this visit" opens `/payments?bill=<appointment id>`, which pre-fills pet, visit link and one line per service (`src/lib/visitServices.ts`); lines stay editable there.

## Connected to

- **owned-by:** clinics, pets
- **joins:** appointments, services, profiles (created_by, verified_by)
- **looks-like-but-is-not:** payments

## If you change this

- **Hits:** `PaymentsPage` and its daily totals, the appointment dialog's Paid / Bill this visit, the calendar Unpaid marker, CSV export (`src/lib/csvExport.ts`), `PrintContext`.
- **Does not hit:** AdminBillingPage.

## See

- Source: `src/lib/database.types.ts:282, 237`
