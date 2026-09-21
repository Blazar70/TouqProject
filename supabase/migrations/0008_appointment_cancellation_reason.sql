-- Touq / طوق — capture why an appointment was cancelled.
-- Completion notes don't need a new column here — they get written
-- straight into medical_records, since that's the actual medical file.
alter table appointments add column cancellation_reason text;
