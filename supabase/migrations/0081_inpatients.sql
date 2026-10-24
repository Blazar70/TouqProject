-- Touq / طوق — phase 6, inpatients: a stay (admit → discharge) with timed updates (note, optional
-- vitals, photos/videos). Clinic answer (2026-10-20): branches are no wall; an inpatient's location
-- is the branch of whoever recorded the latest update, and other branches are shown by name.
-- Doctors and managers admit and discharge; doctors, nurses and managers write updates; everyone
-- in the clinic reads. Updates are never edited; the author or a manager may delete one.

create table inpatient_stays (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  pet_id uuid not null references pets (id) on delete cascade,
  branch_id uuid not null,
  reason text,
  admitted_at timestamptz not null default now(),
  admitted_by uuid references profiles (id) on delete set null,
  discharged_at timestamptz,
  discharged_by uuid references profiles (id) on delete set null,
  discharge_note text,
  foreign key (branch_id, clinic_id) references branches (id, clinic_id)
);
-- One open stay per pet.
create unique index inpatient_stays_one_open on inpatient_stays (pet_id) where discharged_at is null;
create index inpatient_stays_open_by_clinic on inpatient_stays (clinic_id) where discharged_at is null;

create table inpatient_updates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id),
  stay_id uuid not null references inpatient_stays (id) on delete cascade,
  branch_id uuid not null,
  author_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  note text,
  weight_kg numeric(6, 2) check (weight_kg > 0 and weight_kg < 1000),
  temperature_c numeric(4, 1) check (temperature_c between 25 and 45),
  heart_rate integer check (heart_rate between 1 and 400),
  -- Storage paths in the inpatient-media bucket: <clinic>/<pet>/<stay>/<file>.
  media text[] not null default '{}',
  check (coalesce(note, '') <> '' or weight_kg is not null or temperature_c is not null or heart_rate is not null or cardinality(media) > 0),
  foreign key (branch_id, clinic_id) references branches (id, clinic_id)
);
create index inpatient_updates_stay on inpatient_updates (stay_id, created_at);

alter table inpatient_stays enable row level security;
alter table inpatient_updates enable row level security;

create policy inpatient_stays_all_admin on inpatient_stays for all using (public.current_user_is_admin());
create policy inpatient_stays_select_staff on inpatient_stays for select
  using (clinic_id = (select public.current_user_clinic_id()));
create policy inpatient_stays_insert_doctor on inpatient_stays for insert
  with check (
    clinic_id = (select public.current_user_clinic_id())
    and (select public.current_user_has_role(array['doctor', 'manager']))
    and discharged_at is null
    and pet_id in (select id from pets where clinic_id = (select public.current_user_clinic_id()) and deleted_at is null)
  );
create policy inpatient_stays_update_doctor on inpatient_stays for update
  using (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['doctor', 'manager'])))
  with check (clinic_id = (select public.current_user_clinic_id()));
-- Discharge is the only client edit (the location moves by trigger below).
revoke update on inpatient_stays from authenticated;
grant update (discharged_at, discharge_note) on inpatient_stays to authenticated;

create policy inpatient_updates_all_admin on inpatient_updates for all using (public.current_user_is_admin());
create policy inpatient_updates_select_staff on inpatient_updates for select
  using (clinic_id = (select public.current_user_clinic_id()));
create policy inpatient_updates_insert_clinician on inpatient_updates for insert
  with check (
    clinic_id = (select public.current_user_clinic_id())
    and (select public.current_user_has_role(array['doctor', 'nurse', 'manager']))
    and author_id = (select auth.uid())
    and stay_id in (select id from inpatient_stays where clinic_id = (select public.current_user_clinic_id()) and discharged_at is null)
  );
create policy inpatient_updates_delete_author on inpatient_updates for delete
  using (
    clinic_id = (select public.current_user_clinic_id())
    and (author_id = (select auth.uid()) or (select public.current_user_has_role(array['manager'])))
  );
revoke update on inpatient_updates from authenticated;

-- Who and when come from the database, not the client.
create function public.fill_inpatient_stay()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.admitted_at := now();
    new.admitted_by := auth.uid();
  elsif new.discharged_at is not null and old.discharged_at is null then
    new.discharged_at := now();
    new.discharged_by := auth.uid();
  elsif old.discharged_at is not null and new.discharged_at is distinct from old.discharged_at then
    raise exception 'This stay was already discharged' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger inpatient_stays_fill before insert or update on inpatient_stays
  for each row execute function public.fill_inpatient_stay();

-- The newest update decides where the pet is now. Security definer: clients can't update branch_id.
create function public.move_inpatient_to_update_branch()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.created_at := now();
  update inpatient_stays set branch_id = new.branch_id where id = new.stay_id and branch_id is distinct from new.branch_id;
  return new;
end;
$$;
create trigger inpatient_updates_move_stay before insert on inpatient_updates
  for each row execute function public.move_inpatient_to_update_branch();

-- Staff admit and write updates only at branches they work at (same rule as visit records, 0076).
create trigger inpatient_stays_z_branch_write before insert on inpatient_stays
  for each row execute function public.enforce_branch_write();
create trigger inpatient_updates_z_branch_write before insert on inpatient_updates
  for each row execute function public.enforce_branch_write();

-- Private bucket per clinic folder: short videos up to 30 MB; the app keeps photos at 5 MB like pet photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inpatient-media', 'inpatient-media', false, 31457280,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']);

create policy inpatient_media_select_own_clinic on storage.objects for select
  using (bucket_id = 'inpatient-media' and (storage.foldername(name))[1] = public.current_user_clinic_id()::text);
create policy inpatient_media_insert_own_clinic on storage.objects for insert
  with check (bucket_id = 'inpatient-media' and (storage.foldername(name))[1] = public.current_user_clinic_id()::text);
create policy inpatient_media_delete_own_clinic on storage.objects for delete
  using (bucket_id = 'inpatient-media' and (storage.foldername(name))[1] = public.current_user_clinic_id()::text);
