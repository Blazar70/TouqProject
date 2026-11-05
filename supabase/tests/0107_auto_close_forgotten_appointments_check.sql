-- Checks for migration 0107 (forgotten appointments close themselves). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0107_auto_close_forgotten_appointments_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

insert into auth.users (id, email, aud, role) values
  ('f1070000-0000-0000-0000-000000000001', 'm107@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f1070000-0000-0000-0000-00000000000a', '0107 check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f1070000-0000-0000-0000-000000000001', 'vet', 'f1070000-0000-0000-0000-00000000000a', 'M', 'manager');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f1070000-0000-0000-0000-0000000000c1', 'f1070000-0000-0000-0000-00000000000a', 'Check pet', 'dog', 'Owner');

-- Last digit of the id = what the row is, see the asserts.
insert into appointments (id, pet_id, clinic_id, created_by, status, scheduled_at)
select ('f1070000-0000-0000-0000-0000000000a' || x.n)::uuid, 'f1070000-0000-0000-0000-0000000000c1', 'f1070000-0000-0000-0000-00000000000a',
       'f1070000-0000-0000-0000-000000000001', x.status, now() - x.age
from (values
  (1, 'requested', interval '4 days'),
  (2, 'confirmed', interval '4 days'),
  (3, 'requested', interval '2 days'),
  (4, 'arrived', interval '4 days'),
  (5, 'in_session', interval '4 days'),
  (6, 'completed', interval '4 days'),
  (7, 'requested', interval '4 days'),
  (8, 'confirmed', interval '4 days'),
  (9, 'confirmed', interval '4 days')
) x(n, status, age);

insert into medical_records (pet_id, clinic_id, appointment_id) values
  ('f1070000-0000-0000-0000-0000000000c1', 'f1070000-0000-0000-0000-00000000000a', 'f1070000-0000-0000-0000-0000000000a7');
insert into services (id, clinic_id, name, price) values
  ('f1070000-0000-0000-0000-0000000000d1', 'f1070000-0000-0000-0000-00000000000a', 'Exam', 100);
insert into appointment_services (appointment_id, service_id) values
  ('f1070000-0000-0000-0000-0000000000a8', 'f1070000-0000-0000-0000-0000000000d1');
insert into invoices (clinic_id, created_by, amount_total, appointment_id, branch_id)
select 'f1070000-0000-0000-0000-00000000000a', 'f1070000-0000-0000-0000-000000000001', 100, 'f1070000-0000-0000-0000-0000000000a9', id
from branches where clinic_id = 'f1070000-0000-0000-0000-00000000000a' and is_main;

do $$
declare
  v_first integer;
  st text;
begin
  v_first := public.auto_close_forgotten_appointments();
  assert v_first >= 2, 'closes at least the two forgotten ones';
  assert (select count(*) from appointments
          where id in ('f1070000-0000-0000-0000-0000000000a1', 'f1070000-0000-0000-0000-0000000000a2')
            and status = 'cancelled' and cancellation_category = 'auto_closed') = 2, 'old requested and confirmed are closed, with their own reason';

  assert (select status from appointments where id = 'f1070000-0000-0000-0000-0000000000a3') = 'requested', '2 days old stays';
  assert (select status from appointments where id = 'f1070000-0000-0000-0000-0000000000a4') = 'arrived', 'arrived is never closed';
  assert (select status from appointments where id = 'f1070000-0000-0000-0000-0000000000a5') = 'in_session', 'in session is never closed';
  assert (select status from appointments where id = 'f1070000-0000-0000-0000-0000000000a6') = 'completed', 'completed stays';
  assert (select status from appointments where id = 'f1070000-0000-0000-0000-0000000000a7') = 'requested', 'one with a visit record stays';
  assert (select status from appointments where id = 'f1070000-0000-0000-0000-0000000000a8') = 'confirmed', 'one with services stays';
  assert (select status from appointments where id = 'f1070000-0000-0000-0000-0000000000a9') = 'confirmed', 'one with a bill stays';

  assert (select target_label from admin_audit_log where action = 'appointments_auto_closed' and clinic_id = 'f1070000-0000-0000-0000-00000000000a') = '2',
    'one log row per clinic with the count';
  assert public.auto_close_forgotten_appointments() = 0, 'a second run closes nothing';
  assert (select count(*) from admin_audit_log where action = 'appointments_auto_closed' and clinic_id = 'f1070000-0000-0000-0000-00000000000a') = 1,
    'a run that closes nothing logs nothing';

  assert not has_function_privilege('authenticated', 'public.auto_close_forgotten_appointments()', 'execute'), 'staff cannot run it';
  assert not has_function_privilege('anon', 'public.auto_close_forgotten_appointments()', 'execute'), 'the public cannot run it';
end $$;

rollback;
