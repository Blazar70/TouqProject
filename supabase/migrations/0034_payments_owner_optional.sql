-- Touq / طوق — `payments.owner_id` was NOT NULL from the original schema,
-- written when owner self-signup was expected to populate pets.owner_id
-- for most pets. That flow never really got used (owner accounts are
-- effectively unused in this app), so pets.owner_id is null for nearly
-- every real pet — making it impossible for the new admin Billing Ledger
-- to record a payment against a real pet without a registered owner
-- account. Relaxing this to nullable, matching pets.owner_id's own
-- nullability, unblocks that without inventing a fake owner account.
alter table payments alter column owner_id drop not null;
