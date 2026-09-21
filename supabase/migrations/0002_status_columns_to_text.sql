-- Touq / طوق — convert status enums to text + check constraints
-- Run in the Supabase SQL editor after 0001_init.sql.
-- See discussion: enums make adding a new status value (e.g. "no_show")
-- a schema migration; text + check makes it a constraint edit.

-- Appointments
alter table appointments
  alter column status drop default;
alter table appointments
  alter column status type text using status::text;
alter table appointments
  alter column status set default 'requested';
alter table appointments
  add constraint appointments_status_check
  check (status in ('requested', 'confirmed', 'completed', 'cancelled'));

-- Payments
alter table payments
  alter column status drop default;
alter table payments
  alter column status type text using status::text;
alter table payments
  alter column status set default 'pending';
alter table payments
  add constraint payments_status_check
  check (status in ('pending', 'paid', 'overdue', 'cancelled'));

-- Ownership transfers
alter table ownership_transfers
  alter column status drop default;
alter table ownership_transfers
  alter column status type text using status::text;
alter table ownership_transfers
  alter column status set default 'pending';
alter table ownership_transfers
  add constraint ownership_transfers_status_check
  check (status in ('pending', 'accepted', 'declined'));

-- The enum types are now unused; drop them.
drop type appointment_status;
drop type payment_status;
drop type transfer_status;
