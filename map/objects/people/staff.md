---
type: object
cluster: people
universe: live
status: verified   # 2026-10-21 @ feature/staff-accounts (staging only; not on live until v2)
entity: supabase/migrations/0047_staff_accounts.sql
---

# Staff (clinic logins)

Clinic staff are logins: `profiles` rows with `role = 'vet'` and a `clinic_role` (manager / doctor / nurse / receptionist). Product word "staff". There is no separate staff table any more.

## Why this shape

Every staff member signs in (clinic owner, 2026-10-20), so the old `caregivers` table (names without logins, 0010) was retired in 0047 instead of being linked later. Staff are never deleted: "Remove staff member" disables the account, because medical records, appointments and invoices point at the profile.

## Shape

- Login: `profiles.username` (unique across Touq, `^[a-z0-9][a-z0-9._-]{2,29}$`; auth email is the synthetic `<username>@staff.touq.invalid`) **or** a real email (admin desk or manager form), copied to `profiles.email` (0049) so the app can show it. Parsing/validation: `parseStaffLogin()` in `supabase/functions/_shared/staffRules.ts`, shared by the edge functions and the pages.
- Branches: `staff_branches` rows ([branches](branches.md)). Staff below manager need at least one. A manager with no rows covers the whole clinic; with rows, only those branches (`current_user_branch_ids()`, 0047).
- Appointments point at a doctor through `appointments.doctor_id` (composite FK with `clinic_id`, 0047). Calendar columns / pickers = `takes_appointments` and not `disabled`, ordered by `calendar_order` (no UI to set it until phase 5), then name.
- Removed = `profiles.disabled` + auth ban (`876000h`), set together by `set_disabled`. Restore reverses both. Login while banned shows `admin.accountDisabledBody`.
- All writes go through the edge function `clinic-manage-staff` (service role; the 0047 profile guard lets it through). Who may do what is the pure `staffChangeError()` in `_shared/staffRules.ts` (unit-tested in `src/lib/staffRules.test.ts`): only admins create or touch managers and change logins; managers can't change their own role/branches/access; branch managers only reach staff/branches in their branches; a clinic always keeps one active manager.

- Time off (0058): table `doctor_time_off` (reason readable only by managers of that doctor + admins via `can_manage_doctor_time_off()`); everyone in the clinic reads periods without reason through `doctor_time_off_periods()`. Writes via `save_doctor_time_off()` (returns how many appointments it unassigned: requested, confirmed and, since 0073, arrived); delete is a plain delete. UI: `TimeOffPanel` on StaffPage. Check `supabase/tests/0058_doctor_time_off_check.sql`, rollback `0058_down.sql`.

## Connected to

- **is:** [profiles](profiles.md) (role `vet`)
- **owned-by:** clinics
- **joins:** staff_branches, appointments.doctor_id, medical_records.vet_id, invoices.created_by/verified_by
- **looks-like-but-is-not:** pet_trusted_contacts (people who bring a pet); the retired `caregivers` table

## If you change this

- **Hits:** `clinic-manage-staff`, `admin-manage-clinic` (create makes the first manager), `_shared/staffRules.ts` (+ its test), `StaffPage`, `AdminPage` (add user, user popup), `AppointmentsPage`/`SessionPage`/`StaffAppointments` (doctor_id), `LoginPage` (username → synthetic email), `adminAudit.ts` labels (`staff_*`), `admin_clinic_counts()` (staff = enabled vet profiles).
- **Does not hit:** pets, invoices schema.

## Surfaces

| Surface | Role |
|---|---|
| `src/pages/StaffPage.tsx` | managers manage staff below manager; others read |
| `src/pages/AdminPage.tsx` | admin: add user (any role), role/branches/login in the user popup, disable/enable |
| `supabase/functions/clinic-manage-staff/index.ts` | every staff write |

## See

- Checks: `supabase/tests/0047_staff_accounts_check.sql`, `0049_profile_login_email_check.sql`; rollbacks `supabase/rollbacks/0047_down.sql`, `0049_down.sql`
- Design: `docs/design/staff-branches-calendar.md` §1.2, §3
