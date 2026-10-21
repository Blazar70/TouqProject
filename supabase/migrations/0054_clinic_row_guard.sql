-- Touq / طوق — clinic row guard (decided 2026-10-21). clinics_update_vet
-- (0021) lets any staff member update every column of their clinic row, so a
-- doctor could flip billing_status, disabled or deleted_at. Non-admins may now
-- change only name, phone and logo_url (logo_url is narrowed further by 0053).
-- Whitelist, so a column added later is admin-only until listed here.
-- Who may edit name/phone (managers only?) is left for phase 4.

create function public.enforce_clinic_row_update()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
    and auth.uid() is not null
    and not public.current_user_is_admin()
    and (to_jsonb(new) - array['name', 'phone', 'logo_url'])
      is distinct from (to_jsonb(old) - array['name', 'phone', 'logo_url'])
  then
    raise exception 'only an admin may change this clinic setting';
  end if;
  return new;
end;
$$;

create trigger clinics_enforce_row_update
  before update on clinics
  for each row execute function public.enforce_clinic_row_update();
