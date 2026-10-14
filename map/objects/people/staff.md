---
type: object
cluster: people
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0010_caregivers_are_staff.sql
---

# Staff (table `caregivers`)

Clinic staff such as vet techs and assistants. Product word "staff"; table name `caregivers`.

## Why this shape

0001 made caregivers per-pet contacts. 0010 re-purposed the table to clinic staff in place; the old name stayed. Per-pet contacts moved to `pet_trusted_contacts`.

## Shape

- `clinic_id` not null, `name`, `phone`, `title`, `deleted_at` (0032 soft delete). `0010`, `0032`
- No link to `auth.users`. Staff are records, not logins.
- Referenced by `appointments.assigned_staff_id` (0011).
- Policies: `caregivers_all_vet` (clinic scope), `caregivers_all_admin`. Owners have no access (their policy was dropped in 0010).

## Connected to

- **owned-by:** clinics
- **joins:** appointments.assigned_staff_id
- **looks-like-but-is-not:** profiles (vets who log in), pet_trusted_contacts (people who bring a pet)

## If you change this

- **Hits:** `StaffPage`, appointment assignment and conflict check (`src/lib/appointmentConflicts.ts`), purge cron (clears assigned_staff_id), `admin-manage-clinic` purge.
- **Does not hit:** login/auth, RLS helpers.

## Surfaces

| Surface | Role |
|---|---|
| `src/pages/StaffPage.tsx` | CRUD, trash/restore |
| `src/pages/AppointmentsPage.tsx` | reads for assignment |

## See

- Source: `src/lib/database.types.ts:169`
