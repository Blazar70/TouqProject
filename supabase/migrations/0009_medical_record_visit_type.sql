-- Touq / طوق — categorize medical records by visit type
-- text + check (not enum) for the same reason as appointment/payment status:
-- this list will likely need tweaking as real clinic workflows surface
-- edge cases, and a constraint edit is much cheaper than a schema migration.
alter table medical_records add column visit_type text
  check (visit_type in ('checkup', 'vaccination', 'surgery', 'emergency', 'follow_up', 'grooming', 'other'));
