-- 0072: "arrived" appointment status (P3, user 2026-10-23): reception checks the pet in,
-- between confirmed and in session, so doctors see who is waiting.
alter table appointments drop constraint appointments_status_check;
alter table appointments
  add constraint appointments_status_check
  check (status in ('requested', 'confirmed', 'arrived', 'in_session', 'completed', 'cancelled'));
