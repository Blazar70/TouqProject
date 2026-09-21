-- Touq / طوق — same trash-with-recovery pattern as clinics (0031), applied
-- to the clinic-side delete actions: deleting a pet or staff member now
-- soft-deletes (stamps deleted_at) instead of removing the row immediately,
-- recoverable for 7 days via a Trash view on the Pets/Staff pages.

alter table pets add column deleted_at timestamptz;
alter table caregivers add column deleted_at timestamptz;

-- Purges anything past the retention window. Runs as postgres (bypasses
-- RLS, which is fine — this is a scheduled maintenance job, not a user
-- request), so unlike the clinic-purge cron this doesn't need an edge
-- function or a bearer secret at all, just plain SQL on a schedule.
--
-- payments has no cascade from pets (confdeltype 'a' = restrict), and
-- appointments.assigned_staff_id has no cascade from caregivers either —
-- both would raise a foreign-key violation on a straight delete otherwise,
-- so those references are cleared first.
select cron.schedule(
  'purge-trashed-pets-and-staff',
  '0 3 * * *',
  $$
  delete from payments where pet_id in (
    select id from pets where deleted_at is not null and deleted_at < now() - interval '7 days'
  );
  delete from pets where deleted_at is not null and deleted_at < now() - interval '7 days';
  update appointments set assigned_staff_id = null where assigned_staff_id in (
    select id from caregivers where deleted_at is not null and deleted_at < now() - interval '7 days'
  );
  delete from caregivers where deleted_at is not null and deleted_at < now() - interval '7 days';
  $$
);
