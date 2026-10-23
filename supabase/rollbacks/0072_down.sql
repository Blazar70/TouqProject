-- Rollback for 0072_arrived_status.sql. Arrived appointments go back to confirmed first.
update appointments set status = 'confirmed' where status = 'arrived';
alter table appointments drop constraint appointments_status_check;
alter table appointments
  add constraint appointments_status_check
  check (status in ('requested', 'confirmed', 'in_session', 'completed', 'cancelled'));
