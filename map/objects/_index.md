# Noun index

All cards verified 2026-10-14 @ 583fe57. Line numbers in `database.types.ts` are for the generated types; the migrations are the origin.

## people
- [profiles](people/profiles.md) — login row; role vet / owner / admin; `disabled`
- [clinics](people/clinics.md) — the tenant; disable / trash; `billing_status`
- [branches](people/branches.md) — clinic locations + `staff_branches`; one main per clinic; no UI yet (0044-0046)
- [owner-files](people/owner-files.md) — pet owners (customers) per clinic + prepaid balance ledger `owner_balance_entries` (0063-0064)
- [staff](people/staff.md) — clinic logins (`profiles` role vet + clinic_role); caregivers retired in 0047

## care
- [inpatients](care/inpatients.md) — phase 6 stays + timed updates with vitals/photos/videos; location = branch of the latest update (0081)
- [waivers](care/waivers.md) — phase 6 signed consent forms: manager templates (EN + AR), owner signs on the tablet, frozen copy, manager void (0084)
- [pets](care/pets.md) — the animal; vaccination columns; owner contact text; soft delete
- [appointments](care/appointments.md) — status machine; cancellation category; assignee
- [medical-records](care/medical-records.md) — visit note written on completion
- [trusted-contacts](care/trusted-contacts.md) — table `pet_trusted_contacts`
- [ownership-transfers](care/ownership-transfers.md) — **ghost**, nothing uses it

## money
- vaccines — clinic vaccine list + per-pet schedules + dose history (0067); see [pets](care/pets.md), `src/components/VaccinationPanel.tsx`, `VaccinesSettings.tsx`
- [invoices](money/invoices.md) — what pet owners owe/paid the clinic (+ `invoice_items`, `invoice_payments`, `credit_notes`, per-branch numbers, 0060-0061; reports 0065; Manager page `/manager` (`ManagerPage.tsx`, managers only): income today/month, unpaid, `report_cash_differences()` 0080, visits per doctor, clinic activity); also visit services `appointment_services` (0059)
- [services](money/services.md) — clinic price list
- [payments](money/payments.md) — what a clinic pays Touq (admin-only), NOT pet-owner payments

## platform
- [admin-audit-log](platform/admin-audit-log.md) — admin actions, two writers
- [push](platform/push.md) — `push_subscriptions` + `appointment_reminders_sent`
- [storage-buckets](platform/storage-buckets.md) — `pet-photos` and `payment-documents`, both private

## Not carded (rules in code, cited from cards)

`src/lib/vaccination.ts`, `cancellation.ts`, `appointmentConflicts.ts`, `phone.ts`, `species.ts`, `i18n/translations.ts`, `csvExport.ts`, `PrintContext.tsx`. Open the file directly.
