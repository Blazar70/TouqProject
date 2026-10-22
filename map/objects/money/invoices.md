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

## Shape (invoicing core, 0060-0061, 2026-10-22)

- `invoices`: `clinic_id`, `pet_id` (cascade), `appointment_id` (set null), `invoice_number` (`CODE-000001` per branch), `amount_total` (incl. VAT, after discounts), `vat_total`, bill discount `discount_type/value/amount/reason`, `amount_paid`, `amount_credited`, `amount_refunded`, `payment_status` unpaid/partly_paid/paid (kept by the DB), `notes`, `created_at` (= invoice date). The old `method`, `status` recorded/verified, `paid_at`, `verified_*` and the "verify against the slip" step are gone (moved to `invoice_payments`).
- `invoice_items`: `position`, `service_id`, `description`, `unit_price` (incl. VAT, as typed), `quantity`, `vat_rate` (service's, 15 for custom lines), line discount `discount_*`, `line_total` (after line discount), `bill_discount_share`, `vat_amount`.
- `invoice_payments`: `invoice_id`, `method` (cash/card/apple_pay/balance; `balance` since 0064 takes the money from the pet's owner's balance by trigger, same transaction, refused when too little), `amount`, `paid_at`, `received_by`, `branch_id`.
- `credit_notes`: `credit_number` `CN-CODE-000001` (own per-branch counter), `item_ids`, `amount`, `vat_amount`, `reason` (required), `refund_method` (`balance` since 0064 = refund goes onto the owner's balance), `refund_amount` (credit first reduces what is owed; the rest is refunded).
- Numbers: `invoice_counters (branch_id, kind)` bumped under a row lock by trigger `assign_document_number()`, never reused; `branches.invoice_code` locked once a counter row exists. `supabase/migrations/0060_invoice_numbers.sql`
- VAT: prices are VAT-inclusive; per line `vat = round(x * r / (100 + r), 2)` on the amount after line and (spread) bill discounts. Mirror in `src/lib/invoiceMath.ts` (preview only).
- Writes: clients have no insert/update/delete on `invoices`, `invoice_items`, `invoice_payments`, `credit_notes`. Only `create_invoice()`, `add_invoice_payment()`, `create_credit_note()` (security definer) write. Non-managers' discounts capped at `clinics.max_staff_discount_percent` (fixed amount = its percent). Discounts and credit notes logged by trigger `log_invoice_money()` (`discount_given`, `credit_note_issued`). `supabase/migrations/0061_invoicing_core.sql`, checks `supabase/tests/0060_*`, `0061_*`, rollbacks `0061_down.sql` then `0060_down.sql`.
- Print: `PrintContext.printInvoice()` (bilingual labels, ZATCA phase-1 QR via `src/lib/zatcaQr.ts` + `qrcode-generator`, only when `clinics.vat_number` is set). UI: `PaymentsPage` + `components/InvoiceDetail.tsx`.
- `branch_id` not null (0046), the Payments page sends the picked branch (phase 3); trigger `fill_default_branch()` fills main only when none is sent. List defaults to the picked branch, managers can switch. See [branches](../people/branches.md).
- Policies: vet by clinic, admin all.
- One invoice per appointment: unique `appointment_id` (0059). An invoice linked to a visit = the visit is billed; the calendar shows "Unpaid" on completed visits without one or with an unpaid one, "Partly paid" when partly paid (`AppointmentsPage`, embed `invoice:invoices(id, invoice_number, payment_status)`).

## Visit services (0059)

- `appointment_services`: `appointment_id` (cascade), `service_id` (set null), `description`, `unit_price` (pre-VAT, 4 dp), `vat_rate`, `quantity`, `clinic_id`, `added_by`. Policies: vet by clinic, admin all.
- Trigger `appointment_services_guard()` copies name/price/VAT/clinic from the price list on insert (client values ignored), lets only `quantity` change, and refuses any insert/update/delete once an invoice links the appointment. `supabase/migrations/0059_visit_services.sql`, check `supabase/tests/0059_visit_services_check.sql`.
- UI: `src/components/VisitServices.tsx` on SessionPage and the completed-appointment dialog. "Bill this visit" opens `/payments?bill=<appointment id>`, which pre-fills pet, visit link and one line per service (`src/lib/visitServices.ts`); lines stay editable there.

## Connected to

- **owned-by:** clinics, pets
- **joins:** appointments, services, profiles (created_by, verified_by)
- **looks-like-but-is-not:** payments

## If you change this

- **Hits:** `PaymentsPage` and its daily totals (from `invoice_payments`), DashboardPage revenue (`invoice_payments`), the appointment dialog's Paid / Bill this visit, the calendar Unpaid marker, CSV export (`src/lib/csvExport.ts`), `PrintContext`.
- **Does not hit:** AdminBillingPage.

## See

- Source: `src/lib/database.types.ts:282, 237`
