---
type: process
status: verified   # 2026-10-14 @ 583fe57
consumes: [pets, staff, clinics]
produces: []
---

# trash-and-purge

Soft delete with a 7-day recovery window for pets, staff and clinics.

## Input → Movement → Output

Delete click → `deleted_at` stamped (clinics also get `disabled`) → listed in a Trash view for 7 days → a scheduled job deletes the rows.

## Steps

1. Pets/staff: update `deleted_at`. `src/pages/PetsPage.tsx:98`; restore sets null `:126`
2. Daily job at 03:00 deletes pets and staff older than 7 days, first clearing `appointments.assigned_staff_id`. Latest definition: `supabase/migrations/0035_clinic_billing_payments.sql:21`
3. Clinics: `trash` / `restore` / `purge_expired` actions in the edge function. See [clinic-lifecycle](clinic-lifecycle.md).

## Watch out

Trashed pets and staff are hidden by each query (`.is('deleted_at', null)`), not by RLS. A new query on `pets` or `caregivers` that forgets the filter will show trashed rows.

## If you change this

- **Hits:** every query on pets/caregivers; the job body (re-schedule under the same job name to replace it).
- **Does not hit:** medical records or invoices, which cascade on the final pet delete.
