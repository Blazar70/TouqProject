-- Undo 0105.
drop trigger pet_waivers_y_fingerprint on pet_waivers;
drop function public.pet_waivers_set_fingerprint();
drop function public.fingerprint_ok(pet_waivers);
drop function public.waiver_fingerprint(pet_waivers);
alter table pet_waivers drop column fingerprint;
