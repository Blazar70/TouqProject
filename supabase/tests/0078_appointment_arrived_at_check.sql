-- Checks for migration 0078 (arrived_at). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0078_appointment_arrived_at_check.sql
-- One transaction, rolled back at the end. Runs as postgres (auth.uid() null), so role triggers stay out of the way.
begin;
do $$
declare
  appt uuid := (select id from appointments where status = 'confirmed' limit 1);
  first_arrival timestamptz;
begin
  assert appt is not null, 'needs one confirmed appointment on staging';
  assert (select arrived_at from appointments where id = appt) is null, 'confirmed has no arrived_at';

  update appointments set status = 'arrived' where id = appt;
  first_arrival := (select arrived_at from appointments where id = appt);
  assert first_arrival is not null, 'arrived sets arrived_at';

  update appointments set reason = coalesce(reason, '') where id = appt;
  assert (select arrived_at from appointments where id = appt) = first_arrival, 'other edits keep arrived_at';

  update appointments set status = 'in_session' where id = appt;
  assert (select arrived_at from appointments where id = appt) = first_arrival, 'starting the session keeps arrived_at';

  update appointments set status = 'confirmed' where id = appt;
  assert (select arrived_at from appointments where id = appt) is null, 'undoing check-in clears arrived_at';
end $$;
rollback;
select '0078 arrived_at: all checks passed' as result;
