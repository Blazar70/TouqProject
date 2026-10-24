-- Rollback for 0083_storage_and_name_locks.sql. Restores the 0053 / 0035 / 0049 state.
drop policy "clinic_logos_select" on storage.objects;
create policy "clinic_logos_select" on storage.objects
  for select
  using (bucket_id = 'clinic-logos');

update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'payment-documents';

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
    then
      raise exception 'only an admin may change role, clinic_id, disabled, clinic_role, takes_appointments, title, calendar_order, username, or email';
    end if;
  end if;
  return new;
end;
$$;
