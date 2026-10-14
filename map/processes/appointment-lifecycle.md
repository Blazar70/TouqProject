---
type: process
status: verified   # 2026-10-14 @ 583fe57
consumes: [pets, appointments, staff]
produces: [appointments, medical-records]
---

# appointment-lifecycle

An appointment is requested, confirmed, then completed (writing a medical record) or cancelled (with a category).

## Input → Movement → Output

Staff pick pet, time and optional assignee → row inserted as requested → status changes → completion writes a medical record; cancellation stores a category and reason.

## Why this shape

Conflicts only warn, because back-to-back and same-day visits are legitimate. Completion and cancellation go through a confirm step so a stray click cannot close a visit.

## Steps

1. Create with `assigned_staff_id`; conflicts checked first. `src/pages/AppointmentsPage.tsx:280`, `src/lib/appointmentConflicts.ts:23`
2. Status update. `src/pages/AppointmentsPage.tsx:397`
3. Complete: update status, then insert a medical record, optional photo. `src/pages/AppointmentsPage.tsx:541-586`
4. Cancel: set status, `cancellation_category`, `cancellation_reason`. `src/pages/AppointmentsPage.tsx:455`
5. Fire `notify-status-change`, best-effort. `src/pages/AppointmentsPage.tsx:411`

## If you change this

- **Hits:** statuses in the DB check, `appointmentStatus.ts`, translations, push functions (they filter on status strings).
- **Does not hit:** invoices.

## See

- Objects: [appointments](../objects/care/appointments.md), [medical-records](../objects/care/medical-records.md)
