-- Undoes 0050_in_session.sql: psql "$DATABASE_URL" -1 -f <file>.
-- Appointments still in session go back to confirmed (their session start time is lost).

update appointments set status = 'confirmed' where status = 'in_session';

alter table appointments drop column started_at;

alter table appointments drop constraint appointments_status_check;
alter table appointments
  add constraint appointments_status_check
  check (status in ('requested', 'confirmed', 'completed', 'cancelled'));
