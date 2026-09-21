-- Touq / طوق — pets get plain owner contact info instead of a required
-- linked owner account.
-- Pet owners are a future-phase target per the product notes, so there's no
-- real owner login to link to yet. owner_id stays on the table for when
-- that phase arrives (an owner claiming/linking their pet later), but it's
-- no longer required at registration time.
alter table pets alter column owner_id drop not null;
alter table pets add column owner_name text not null default '';
alter table pets add column owner_phone text;
alter table pets add column owner_email text;
alter table pets alter column owner_name drop default;
