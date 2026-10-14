-- Touq / طوق — per-visit clinical fields on medical_records: vitals
-- (weight, temperature, heart rate) and the structured parts of a visit
-- note (presenting complaint, physical exam, diagnostic plan, remarks).
--
-- Why: doctors want to record these on every completed visit, and a single
-- free-text `notes` box made them inconsistent and impossible to read at a
-- glance. They live here, not on appointments, for the same reason as the
-- rest of the completion note (see 0008): this table is the medical file.
--
-- All columns are nullable: older records don't have them, and a doctor may
-- skip any of them on a given visit. `diagnosis`, `treatment` and `notes` are
-- left as they are, because existing records use them.
--
-- The range checks only reject obvious typos (e.g. 380 instead of 38.0 for a
-- temperature); they are wide enough for any species a clinic sees. The app
-- validates the same ranges before inserting (src/lib/clinicalFields.ts).

alter table medical_records
  add column weight_kg numeric(6, 2)
    check (weight_kg > 0 and weight_kg < 2000),
  add column temperature_c numeric(4, 1)
    check (temperature_c between 25 and 45),
  add column heart_rate_bpm integer
    check (heart_rate_bpm between 1 and 400),
  add column presenting_complaint text,
  add column physical_exam text,
  add column diagnostic_plan text,
  add column remarks text;
