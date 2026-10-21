-- Touq / طوق — clinic logo (decided 2026-10-21). The admin sets it on the
-- Clinics page now; managers get the same upload in Settings later.
-- clinics.logo_url holds the storage path in clinic-logos (plus an optional
-- ?t= cache-buster, like pets.photo_url). Logos are not sensitive, so the
-- bucket is public-read; only an admin or an enabled manager of that clinic
-- may write it, and the same rule guards clinics.logo_url.

alter table clinics add column logo_url text;

insert into storage.buckets (id, name, public)
values ('clinic-logos', 'clinic-logos', true);

-- p_clinic is text because it is the first folder of a storage path.
-- current_user_has_role() is false for a disabled user or clinic (0045).
create function public.can_manage_clinic_logo(p_clinic text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.current_user_is_admin()
    or (p_clinic = public.current_user_clinic_id()::text and public.current_user_has_role(array['manager']));
$$;

-- Upload with upsert reads the existing object, so SELECT is needed too; the
-- objects are public anyway.
create policy "clinic_logos_select" on storage.objects
  for select
  using (bucket_id = 'clinic-logos');

create policy "clinic_logos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'clinic-logos' and public.can_manage_clinic_logo((storage.foldername(name))[1]));

create policy "clinic_logos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'clinic-logos' and public.can_manage_clinic_logo((storage.foldername(name))[1]))
  with check (bucket_id = 'clinic-logos' and public.can_manage_clinic_logo((storage.foldername(name))[1]));

create policy "clinic_logos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'clinic-logos' and public.can_manage_clinic_logo((storage.foldername(name))[1]));

-- clinics_update_vet (0021) lets any staff member update their clinic row;
-- this narrows logo_url to admins and managers. Service role (edge
-- functions) and direct SQL (no JWT) pass.
create function public.enforce_clinic_logo_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.logo_url is distinct from old.logo_url
    and auth.role() is distinct from 'service_role'
    and auth.uid() is not null
    and not public.can_manage_clinic_logo(new.id::text)
  then
    raise exception 'only an admin or a manager of this clinic may change its logo';
  end if;
  return new;
end;
$$;

create trigger clinics_enforce_logo_update
  before update on clinics
  for each row execute function public.enforce_clinic_logo_update();
