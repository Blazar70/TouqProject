-- Touq / طوق — per-clinic totals for the admin page, counted in the database.
-- The admin page used to download every pet/appointment/staff row across all
-- clinics and count them in the browser. PostgREST caps a response at 1000
-- rows by default, so past that the totals silently came out too low.
--
-- security invoker: runs under the caller's RLS, so an admin sees every
-- clinic (the *_all_admin policies) and anyone else only their own.

create or replace function public.admin_clinic_counts()
returns table (clinic_id uuid, pets bigint, appointments bigint, staff bigint)
language sql stable security invoker
set search_path = public
as $$
  select
    c.id,
    (select count(*) from pets p where p.clinic_id = c.id and p.deleted_at is null),
    (select count(*) from appointments a where a.clinic_id = c.id),
    (select count(*) from caregivers s where s.clinic_id = c.id and s.deleted_at is null)
  from clinics c;
$$;
