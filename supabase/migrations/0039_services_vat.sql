-- Touq / طوق — VAT rate per service on the clinic's price list.
--
-- Clinics need to see each service's price before and after VAT, and to
-- type either one. `price` stays the PRE-VAT price (so nothing that reads
-- it today changes meaning); the post-VAT price is derived in the app as
-- price * (1 + vat_rate / 100), rounded to halalas, rather than stored,
-- so the two can never drift apart.
--
-- Default 15 = Saudi VAT, applied to existing services too. Stored per
-- service because some items may be zero-rated or exempt.

alter table services add column vat_rate numeric(5, 2) not null default 15 check (vat_rate >= 0 and vat_rate <= 100);
