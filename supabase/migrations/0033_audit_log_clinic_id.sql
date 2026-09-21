-- Touq / طوق — lets the admin activity log be filtered per clinic (the
-- "view this clinic's activity" button on the admin page). Nullable since
-- not every action has a clinic (e.g. an admin's own account changes), and
-- existing rows predate this column.
alter table admin_audit_log add column clinic_id uuid references clinics (id) on delete set null;
