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

- `invoices`: `clinic_id`, `pet_id` (set null since 0069: a purged pet's bills stay, with `pet_name` + `pet_number` saved on the invoice at insert), `appointment_id` (set null), `invoice_number` (`CODE-000001` per branch), `amount_total` (incl. VAT, after discounts), `vat_total`, bill discount `discount_type/value/amount/reason`, `amount_paid`, `amount_credited`, `amount_refunded`, `payment_status` unpaid/partly_paid/paid (kept by the DB), `notes`, `created_at` (= invoice date). The old `method`, `status` recorded/verified, `paid_at`, `verified_*` and the "verify against the slip" step are gone (moved to `invoice_payments`).
- `invoice_items`: `position`, `service_id`, `description`, `unit_price` (incl. VAT, as typed), `quantity`, `vat_rate` (service's, 15 for custom lines), line discount `discount_*`, `line_total` (after line discount), `bill_discount_share`, `vat_amount`.
- `invoice_payments`: `invoice_id`, `method` (cash/card/apple_pay/balance; `balance` since 0064 takes the money from the pet's owner's balance by trigger, same transaction, refused when too little), `amount`, `paid_at`, `received_by`, `branch_id`.
- `credit_notes`: `credit_number` `CN-CODE-000001` (own per-branch counter), `item_ids`, `amount`, `vat_amount`, `reason` (required), `refund_method` (`balance` since 0064 = refund goes onto the owner's balance), `refund_amount` (credit first reduces what is owed; the rest is refunded).
- Numbers: `invoice_counters (branch_id, kind)` bumped under a row lock by trigger `assign_document_number()`, never reused; `branches.invoice_code` locked once a counter row exists. `supabase/migrations/0060_invoice_numbers.sql`
- VAT: prices are VAT-inclusive; per line `vat = round(x * r / (100 + r), 2)` on the amount after line and (spread) bill discounts. Mirror in `src/lib/invoiceMath.ts` (preview only).
- Writes: clients have no insert/update/delete on `invoices`, `invoice_items`, `invoice_payments`, `credit_notes`. Only `create_invoice()`, `add_invoice_payment()`, `create_credit_note()` (security definer) write. Non-managers' discounts capped at `clinics.max_staff_discount_percent` (fixed amount = its percent). Discounts and credit notes logged by trigger `log_invoice_money()` (`discount_given`, `credit_note_issued`). `supabase/migrations/0061_invoicing_core.sql`, checks `supabase/tests/0060_*`, `0061_*`, rollbacks `0061_down.sql` then `0060_down.sql`.
- Request keys (0102): `create_invoice`, `add_invoice_payment`, `create_credit_note` and `add_owner_balance` take `p_request` (uuid) and store it in `request_id` (unique); the same key again returns the first result instead of saving twice (Save pressed again after a lost answer). The app sends one key per attempt from `useRequestKey()` (`src/lib/requestKey.ts`, renewed after a success). A new money function should do the same. Check `supabase/tests/0102_request_keys_check.sql`.
- Tax phase (0100): trigger `invoices_take_tax_phase` copies `clinics.tax_phase` onto `invoices.tax_phase` at insert; on 'none' it zeroes `vat_total`, and `invoice_items_no_vat_when_unregistered` zeroes each line's `vat_rate`/`vat_amount` (the owner pays the list price, none of it VAT; credit notes follow with 0 VAT). An invoice keeps its phase when the clinic changes. Check `supabase/tests/0100_clinic_tax_phase_check.sql`, rollback `0100_down.sql`.
- Print: `PrintContext.printInvoice()` (bilingual labels, ZATCA phase-1 QR via `src/lib/zatcaQr.ts` + `qrcode-generator`). `InvoiceDetail` passes no VAT number for a 'none' invoice, and no VAT number = plain "Invoice" title, no VAT rows, no "prices include VAT", no QR. Payments preview and InvoiceDetail hide the VAT rows the same way. UI: `PaymentsPage` + `components/InvoiceDetail.tsx`.
- `branch_id` not null (0046), the Payments page sends the picked branch (phase 3); trigger `fill_default_branch()` fills main only when none is sent. List defaults to the picked branch, managers can switch. See [branches](../people/branches.md).
- Policies (0074): read by receptionists and managers of the clinic (`*_select_money`), admin all. Doctors and nurses read 0 rows (invoice_items follows through its invoices subquery). Triggers `invoices_enforce_money_role` / `invoice_payments_enforce_money_role` refuse bills and payments from anyone else ("Only receptionists and managers handle money"); credit notes: 0068. Check `supabase/tests/0074_money_roles_check.sql`, rollback `0074_down.sql`.
- One invoice per appointment: unique `appointment_id` (0059). An invoice linked to a visit = the visit is billed; the calendar shows "Unpaid" on completed visits without one or with an unpaid one, "Partly paid" when partly paid (`AppointmentsPage`, embed `invoice:invoices(id, invoice_number, payment_status)`); receptionists and managers only (0074). "Is it billed" for everyone = computed field `billed(appointments)` (security definer, 0074): `select('*, billed')`, drives the visit-services lock on SessionPage and the dialog.

## Visit services (0059)

- `appointment_services`: `appointment_id` (cascade), `service_id` (set null), `description`, `unit_price` (pre-VAT, 4 dp), `vat_rate`, `quantity`, `clinic_id`, `added_by`. Policies: vet by clinic, admin all.
- Trigger `appointment_services_guard()` copies name/price/VAT/clinic from the price list on insert (client values ignored), lets only `quantity` change, and refuses any insert/update/delete once an invoice links the appointment. `supabase/migrations/0059_visit_services.sql`, check `supabase/tests/0059_visit_services_check.sql`.
- UI: `src/components/VisitServices.tsx` on SessionPage and the completed-appointment dialog. "Bill this visit" (receptionists and managers, 0074) opens `/payments?bill=<appointment id>`, which pre-fills pet, visit link and one line per service (`src/lib/visitServices.ts`); lines stay editable there.

## Reports (0065)

- `ReportsPage` (`/reports`, nav under Clinic). Since 0074: receptionists = cash-up + unpaid, managers = all four; doctors/nurses get no nav item, the route redirects to `/`, and `report_bounds()` refuses them (every report starts there). Income/VAT functions refuse non-managers ("Only managers can see income and VAT reports"). Read-only security-invoker SQL functions, days in clinic time (`report_bounds()` uses `clinics.timezone`): `report_cash_up` (one day, per branch and method: payments + owner deposits − credit-note refunds; `balance` shown apart), `report_unpaid` (completed visits without invoice + not-paid invoices), `report_income_services` / `report_income_branches` and `report_vat_summary` (by invoice / credit-note date = accrual; "collected" by payment date). Credit notes are spread over their lines by `report_credit_lines`. Check `supabase/tests/0065_reports_check.sql`, rollback `0065_down.sql`.
- Counted cash (`CashCountPanel` on the cash-up): table `cash_counts` (0071), receptionists today, managers any past day (trigger `cash_counts_guard`). Since 0073 insert-only: every recount is a new row, the newest per branch and day is current, no update/delete. Reception counts blind: no expected amount, tiles or table until every shown branch is counted today (`ReportsPage` `blind`). Checks `0071_/0073_*_check.sql` (0071 check predates 0073 and only passes on the rolled-back shape).
- CSV via `downloadCsv`, print via `PrintContext.printReport()`. Client "today" = `clinicDay()` in `src/lib/format.ts`.

## Connected to

- **owned-by:** clinics, pets
- **joins:** appointments, services, profiles (created_by, verified_by)
- **looks-like-but-is-not:** payments

## If you change this

- **Hits:** `ReportsPage` and the 0065 report functions (any column change), `PaymentsPage` and its daily totals (from `invoice_payments`), DashboardPage revenue (`invoice_payments`), the appointment dialog's Paid / Bill this visit, the calendar Unpaid marker, CSV export (`src/lib/csvExport.ts`), `PrintContext`.
- **Does not hit:** AdminBillingPage.

- Re-billing (0093): once credit notes cover a bill's whole total, trigger `invoices_release_when_credited` moves `appointment_id`/`stay_id` to `credited_appointment_id`/`credited_stay_id`, so the visit or stay can be billed again (a partly credited bill still blocks). Two FKs now point at appointments: embeds from appointments must name `invoices!invoices_appointment_id_fkey` (AppointmentsPage, PaymentsPage). Check `supabase/tests/0093_rebill_after_full_credit_check.sql`. 0094: the Unpaid report skips a visit whose bill was fully credited (`credited_appointment_id`); "Bill visit" still offers a new bill.
- Print paper (H25): `src/lib/printSize.ts` keeps A4 or 80 mm per device (localStorage `touq-receipt-size`, Settings → Printing on this device); `buildInvoiceDocument` adds `RECEIPT_80MM_STYLES` for invoices, credit notes and deposit receipts. Reports and visit prints stay A4.

## See

- Source: `src/lib/database.types.ts:282, 237`
