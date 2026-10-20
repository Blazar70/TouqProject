-- "In session": the visit has started (Start session) and is not finished yet.
-- It stays in session until Finish, so everyone sees the pet is being worked on.
-- started_at drives the session timer on every device (it used to live in one
-- browser tab's sessionStorage).

alter table appointments drop constraint appointments_status_check;
alter table appointments
  add constraint appointments_status_check
  check (status in ('requested', 'confirmed', 'in_session', 'completed', 'cancelled'));

alter table appointments add column started_at timestamptz;
