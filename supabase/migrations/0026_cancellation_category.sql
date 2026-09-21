-- Touq / طوق — categorize appointment cancellations so the dashboard can
-- report on why appointments are being lost, not just that they were.
-- cancellation_reason stays as optional free-text detail (used when the
-- category is "other" or just extra context); cancellation_category is the
-- groupable value, same "stored in English, translated for display" pattern
-- as visit_type.
alter table appointments add column cancellation_category text;
