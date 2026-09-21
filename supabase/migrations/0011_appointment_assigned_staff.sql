-- Touq / طوق — track which staff member is handling an appointment
alter table appointments add column assigned_staff_id uuid references caregivers (id);
