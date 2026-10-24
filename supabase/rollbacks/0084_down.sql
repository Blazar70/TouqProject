-- Rollback for 0084_waivers.sql. LOSES every signed waiver and every template.
drop table pet_waivers;
drop table waiver_templates;
drop function public.fill_pet_waiver();
