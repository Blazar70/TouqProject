---
type: process
status: verified   # 2026-10-14 @ 583fe57
consumes: [pets, appointments, staff]
produces: [appointments, medical-records]
---

# appointment-lifecycle

An appointment is requested, confirmed, in session (once the session page opens), then completed (writing a medical record) or cancelled (with a category).

## Input → Movement → Output

Staff pick pet, time and optional assignee → row inserted as requested → status changes → completion writes a medical record; cancellation stores a category and reason.

## Why this shape

Conflicts only warn, because back-to-back and same-day visits are legitimate. Completion and cancellation go through a confirm step so a stray click cannot close a visit.

## Steps

1. Create with `doctor_id` (a doctor login, 0047); conflicts checked first. `src/pages/AppointmentsPage.tsx:287`; conflict helper `fetchConflicts` `:68`, rule `src/lib/appointmentConflicts.ts:23`
2. Status update. `src/pages/AppointmentsPage.tsx:404`
3. Complete: update status, then insert a medical record, optional photo. `src/pages/AppointmentsPage.tsx:536-577`
4. Cancel: set status, `cancellation_category`, `cancellation_reason`. `src/pages/AppointmentsPage.tsx:462`
6. Start session: opening `/appointments/:id/session` sets `in_session` + `started_at` (only from requested/confirmed); it stays in session until Finish, and the dialog offers Resume. Since 0075 only doctors and nurses see Start; Resume only for the starter and clinicians of the other role (a nurse joins a doctor's session and vice versa); the visit record is saved during the session (Save) and both write into it. `src/pages/SessionPage.tsx`
5. Fire `notify-status-change`, best-effort. `src/pages/AppointmentsPage.tsx:418`

## If you change this

- **Hits:** statuses in the DB check, `appointmentStatus.ts`, translations, push functions (they filter on status strings).
- **Does not hit:** invoices.

## See

- Objects: [appointments](../objects/care/appointments.md), [medical-records](../objects/care/medical-records.md)
