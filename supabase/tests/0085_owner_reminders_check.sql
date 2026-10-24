-- Checks for migration 0085 (owner reminders sent). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/tests/0085_owner_reminders_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.
begin;

-- 1 receptionist, 2 doctor of clinic a; 3 receptionist of clinic b.
insert into auth.users (id, email, aud, role) values
  ('f8500000-0000-0000-0000-000000000001', 'r85@check.local', 'authenticated', 'authenticated'),
  ('f8500000-0000-0000-0000-000000000002', 'd85@check.local', 'authenticated', 'authenticated'),
  ('f8500000-0000-0000-0000-000000000003', 'o85@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values
  ('f8500000-0000-0000-0000-00000000000a', '0085 check a'),
  ('f8500000-0000-0000-0000-00000000000b', '0085 check b');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f8500000-0000-0000-0000-000000000001', 'vet', 'f8500000-0000-0000-0000-00000000000a', 'R', 'receptionist'),
  ('f8500000-0000-0000-0000-000000000002', 'vet', 'f8500000-0000-0000-0000-00000000000a', 'D', 'doctor'),
  ('f8500000-0000-0000-0000-000000000003', 'vet', 'f8500000-0000-0000-0000-00000000000b', 'O', 'receptionist');
insert into owner_files (id, clinic_id, name) values
  ('f8500000-0000-0000-0000-0000000000f1', 'f8500000-0000-0000-0000-00000000000a', 'Owner a'),
  ('f8500000-0000-0000-0000-0000000000f2', 'f8500000-0000-0000-0000-00000000000b', 'Owner b');

set local role authenticated;

-- Doctor can't mark sent.
select set_config('request.jwt.claims', json_build_object('sub', 'f8500000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into owner_reminders_sent (clinic_id, kind, item_key, owner_file_id) values ('f8500000-0000-0000-0000-00000000000a', 'appointment', 'x', 'f8500000-0000-0000-0000-0000000000f1');
    assert false, 'doctor must not mark reminders sent';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Receptionist marks sent; sent_by is her; twice is refused; another clinic's owner is refused.
select set_config('request.jwt.claims', json_build_object('sub', 'f8500000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into owner_reminders_sent (clinic_id, kind, item_key, owner_file_id, sent_by)
  values ('f8500000-0000-0000-0000-00000000000a', 'vaccine', 'pv:2026-11-01', 'f8500000-0000-0000-0000-0000000000f1', 'f8500000-0000-0000-0000-000000000002');
do $$
begin
  assert (select sent_by = 'f8500000-0000-0000-0000-000000000001' from owner_reminders_sent where item_key = 'pv:2026-11-01'), 'sent_by must be the caller';
  begin
    insert into owner_reminders_sent (clinic_id, kind, item_key) values ('f8500000-0000-0000-0000-00000000000a', 'vaccine', 'pv:2026-11-01');
    assert false, 'the same reminder must not be marked twice';
  exception when unique_violation then null;
  end;
  begin
    insert into owner_reminders_sent (clinic_id, kind, item_key, owner_file_id) values ('f8500000-0000-0000-0000-00000000000a', 'pickup', 'y', 'f8500000-0000-0000-0000-0000000000f2');
    assert false, 'another clinic''s owner must be refused';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Other clinic sees nothing and can't undo it.
select set_config('request.jwt.claims', json_build_object('sub', 'f8500000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
delete from owner_reminders_sent where item_key = 'pv:2026-11-01';
do $$
begin
  assert (select count(*) from owner_reminders_sent where item_key = 'pv:2026-11-01') = 0, 'other clinic must not see it';
end $$;

-- Receptionist undoes it.
select set_config('request.jwt.claims', json_build_object('sub', 'f8500000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from owner_reminders_sent where item_key = 'pv:2026-11-01') = 1, 'the other clinic must not have deleted it';
  delete from owner_reminders_sent where item_key = 'pv:2026-11-01';
  assert (select count(*) from owner_reminders_sent where item_key = 'pv:2026-11-01') = 0, 'receptionist must be able to undo';
end $$;

rollback;
