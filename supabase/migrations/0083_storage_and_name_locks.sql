-- Touq / طوق — low security items from the 2026-10-24 RLS pass (user said fix, 2026-10-25).
-- 1. clinic-logos: anyone could LIST the bucket (the select policy had no role), which
--    reveals every clinic id. Public URLs don't need RLS, so reading a logo still works;
--    only the people who may write a logo (upsert reads the old object) can select.
-- 2. payment-documents: no size or type limit. The admin uploads PDFs only.
-- 3. profiles.full_name: staff could rename themselves, and the name shows in
--    "counted by" and the activity log. Now a manager renames staff on the Staff page
--    (clinic-manage-staff, service role, logged). The platform admin (no clinic) still can.

drop policy "clinic_logos_select" on storage.objects;
create policy "clinic_logos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'clinic-logos' and public.can_manage_clinic_logo((storage.foldername(name))[1]));

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf']
where id = 'payment-documents';

create or replace function public.enforce_profile_self_update_restrictions()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if not (select current_user_is_admin()) then
    if new.role is distinct from old.role
      or new.clinic_id is distinct from old.clinic_id
      or new.disabled is distinct from old.disabled
      or new.clinic_role is distinct from old.clinic_role
      or new.takes_appointments is distinct from old.takes_appointments
      or new.title is distinct from old.title
      or new.calendar_order is distinct from old.calendar_order
      or new.username is distinct from old.username
      or new.email is distinct from old.email
      or (new.full_name is distinct from old.full_name and old.clinic_id is not null)
    then
      raise exception 'only an admin may change role, clinic_id, disabled, clinic_role, takes_appointments, title, calendar_order, username, email, or a staff name';
    end if;
  end if;
  return new;
end;
$$;
