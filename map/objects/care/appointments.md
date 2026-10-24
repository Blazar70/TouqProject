---
type: object
cluster: care
universe: live
status: verified   # 2026-10-21 @ feature/staff-accounts
entity: supabase/migrations/0001_init.sql
---

# Appointments

A scheduled visit for a pet at a clinic, with a status that moves requested, confirmed, in session, then completed or cancelled.

## Why this shape

Status is `text` plus a check constraint, not an enum, so a new status is a constraint edit (0002). The allowed values are mirrored in TypeScript, so both places must change together.

## Shape

- `status` check: requested, confirmed, arrived, in_session, completed, cancelled. `0002_status_columns_to_text.sql`, `in_session` added in `0050_in_session.sql`, `arrived` (reception check-in; Start session works from it) in `0072_arrived_status.sql` (staging only until v2), mirrored in `src/lib/appointmentStatus.ts:3`
- `started_at` (0050, nullable): set when the session page opens and the status becomes in_session; drives the session timer on every device.
- `started_by` (0075, -> profiles): set by trigger `enforce_session_roles` when the status becomes in_session, cleared on Stop session (back to requested/confirmed/arrived), kept on completed. Only doctors and nurses can start; finishing an in-session visit needs `can_work_session()` (starter or a clinician of the other role), and a nurse can't finish one whose record has a diagnosis/treatment/plan. Stop and Cancel stay open to all staff. Mirrored by `canWorkSession` in `src/lib/appointmentStatus.ts`.
- `cancellation_reason` (0008, free text), `cancellation_category` (0026, groupable). Categories live only in code: `src/lib/cancellation.ts:6`; the DB has no check on it.
- `doctor_id` nullable, composite FK `(doctor_id, clinic_id) -> profiles (id, clinic_id)`, on delete set null (doctor_id) (0047; replaced `assigned_staff_id` → caregivers). Read with `doctor:profiles!appointments_doctor_fkey(full_name)`. See [staff](../people/staff.md).
- `branch_id` not null (0046); the app sends the picked branch (phase 3, `BranchContext`); trigger `fill_default_branch()` fills the main branch only when none is sent. Calendar filters by branch; doctor pickers list only doctors who work at the branch (`worksAt`). Index `(branch_id, scheduled_at)`. See [branches](../people/branches.md).
- Doctor time off (0058): trigger `appointments_enforce_doctor_not_away` refuses booking/moving onto a doctor whose `doctor_time_off` covers `scheduled_at` (start inclusive, end exclusive). Saving time off unassigns that doctor's requested/confirmed appointments inside it; never reassigned back. Pickers hide away doctors (`isAway`, `src/lib/timeOff.ts`); day view shows a gray Away background block. See [staff](../people/staff.md).
- Conflict rule: same pet or same staff within 30 minutes, ignoring cancelled; a warning, not a block. `src/lib/appointmentConflicts.ts:6`

## Connected to

- **owned-by:** pets, clinics
- **owns:** `appointment_services` (cascade, 0059); medical_records and invoices point at it (`appointment_id`, 0022 / 0037; one invoice per appointment since 0059)
- **joins:** profiles (doctor_id), appointment_reminders_sent

## If you change this

- **Hits:** AppointmentsPage, StaffAppointments, Dashboard (cancellation reporting), `notify-status-change`, `send-appointment-reminders`, `translations.ts` (`status.*`, `cancellation.*`).
- **Does not hit:** pets (no write-back), invoices (appointment_id is set null on delete).

## Surfaces

| Surface | Role |
|---|---|
| `src/pages/AppointmentsPage.tsx` | create, status change, cancel, complete |
| `supabase/functions/*` | read via service role |

## See

- Process: [appointment-lifecycle](../../processes/appointment-lifecycle.md)
- Source: `src/lib/database.types.ts:98`
