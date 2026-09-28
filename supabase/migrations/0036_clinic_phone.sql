-- Touq / طوق — clinic's own contact phone number, editable from Settings
-- and shown on printed summaries alongside the clinic name.
--
-- Left null for existing clinics: a made-up placeholder number would print
-- on real documents as if it were the clinic's actual contact, so vets
-- fill it in themselves from Settings whenever they're ready.

alter table clinics add column phone text;
