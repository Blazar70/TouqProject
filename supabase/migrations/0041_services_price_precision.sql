-- Touq / طوق — keep the pre-VAT service price to 4 decimals.
--
-- Staff usually type the post-VAT price (what the customer pays). With
-- `price` at 2 decimals, the pre-VAT value derived from it was rounded too
-- early: 150.00 incl. 15% VAT -> 130.43 stored -> 149.99 shown back. At 4
-- decimals every post-VAT price to the halala round-trips exactly (tested
-- in src/lib/vat.test.ts). Widening numeric keeps existing values as-is.

alter table services alter column price type numeric(12, 4);
