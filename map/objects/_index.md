# Noun index

All cards verified 2026-10-14 @ 583fe57. Line numbers in `database.types.ts` are for the generated types; the migrations are the origin.

## people
- [profiles](people/profiles.md) — login row; role vet / owner / admin; `disabled`
- [clinics](people/clinics.md) — the tenant; disable / trash; `billing_status`
- [branches](people/branches.md) — clinic locations + `staff_branches`; one main per clinic; no UI yet (0044-0046)
- [staff](people/staff.md) — clinic logins (`profiles` role vet + clinic_role); caregivers retired in 0047

## care
- [pets](care/pets.md) — the animal; vaccination columns; owner contact text; soft delete
- [appointments](care/appointments.md) — status machine; cancellation category; assignee
- [medical-records](care/medical-records.md) — visit note written on completion
- [trusted-contacts](care/trusted-contacts.md) — table `pet_trusted_contacts`
- [ownership-transfers](care/ownership-transfers.md) — **ghost**, nothing uses it

## money
- [invoices](money/invoices.md) — what pet owners paid the clinic (+ `invoice_items`)
- [services](money/services.md) — clinic price list
- [payments](money/payments.md) — what a clinic pays Touq (admin-only), NOT pet-owner payments

## platform
- [admin-audit-log](platform/admin-audit-log.md) — admin actions, two writers
- [push](platform/push.md) — `push_subscriptions` + `appointment_reminders_sent`
- [storage-buckets](platform/storage-buckets.md) — `pet-photos` and `payment-documents`, both private

## Not carded (rules in code, cited from cards)

`src/lib/vaccination.ts`, `cancellation.ts`, `appointmentConflicts.ts`, `phone.ts`, `species.ts`, `i18n/translations.ts`, `csvExport.ts`, `PrintContext.tsx`. Open the file directly.
