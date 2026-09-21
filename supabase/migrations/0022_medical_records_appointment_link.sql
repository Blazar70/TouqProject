-- Touq / طوق — link medical records back to the appointment that created them
-- Completing an appointment inserts a medical_records row, but nothing tied
-- it back to the appointment it came from, so a past appointment couldn't
-- reliably show its visit details (diagnosis/treatment/notes).

alter table medical_records
  add column appointment_id uuid references appointments (id);
