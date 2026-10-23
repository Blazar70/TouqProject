-- Rollback for 0067_vaccines.sql. LOSES the vaccine list, schedules and dose history;
-- pets.next_vaccination_date keeps the last cached date, the interval column comes back empty.
drop trigger if exists pet_vaccines_sync_pet on pet_vaccines;
drop function if exists public.pet_vaccines_sync_pet();
drop function if exists public.undo_vaccine_dose(uuid);
drop function if exists public.mark_vaccine_given(uuid, date);
drop table if exists vaccine_doses;
drop table if exists pet_vaccines;
drop table if exists vaccines;
alter table pets add column if not exists vaccination_interval_days integer;
notify pgrst, 'reload schema';
