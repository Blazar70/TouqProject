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

1. Pets: update `deleted_at`. (Staff are no longer trashed: removing staff = disable, see [staff](../objects/people/staff.md).) `src/pages/PetsPage.tsx:98`; restore sets null `:126`
2. Daily job at 03:00 deletes pets trashed more than 7 days ago. Latest definition: `supabase/migrations/0047_staff_accounts.sql` (0035 version minus the caregivers lines).
3. Clinics: `trash` / `restore` / `purge_expired` actions in the edge function. See [clinic-lifecycle](clinic-lifecycle.md).

## Watch out

Trashed pets are hidden by each query (`.is('deleted_at', null)`), not by RLS. A new query on `pets` that forgets the filter will show trashed rows.

## If you change this

- **Hits:** every query on pets; the job body (re-schedule under the same job name to replace it).
- **Does not hit:** medical records or invoices, which cascade on the final pet delete.
