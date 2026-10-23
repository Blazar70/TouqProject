-- 0067: vaccines by name (HCI U37 + U26).
-- vaccines        the clinic's list (name + default repeat), managers edit.
-- pet_vaccines    a pet's schedule per vaccine (own repeat, next due date).
-- vaccine_doses   history: which dose, when, by whom. "Mark given" adds one and
--                 moves the due date; undo removes the latest and restores it.
-- Dates are clinic-local calendar days (clinics.timezone), so a dose given late
-- in the evening no longer lands on the previous day (U26).
-- pets.next_vaccination_date stays as a cache: the pet's earliest due date,
-- kept by a trigger, for the pets list badge and admin views.
-- The old single date per pet is test data and is cleared (user, 2026-10-23).

create table vaccines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  interval_days integer not null check (interval_days between 1 and 3650),
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);
create unique index vaccines_clinic_name_idx on vaccines (clinic_id, lower(btrim(name)));

create table pet_vaccines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  pet_id uuid not null references pets (id) on delete cascade,
  vaccine_id uuid not null,
  interval_days integer not null check (interval_days between 1 and 3650),
  next_due_date date not null,
  created_at timestamptz not null default now(),
  unique (pet_id, vaccine_id),
  -- A vaccine in use can't be deleted from the clinic list.
  foreign key (vaccine_id, clinic_id) references vaccines (id, clinic_id) on delete restrict
);
create index pet_vaccines_clinic_due_idx on pet_vaccines (clinic_id, next_due_date);

create table vaccine_doses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  pet_vaccine_id uuid not null references pet_vaccines (id) on delete cascade,
  given_on date not null,
  given_by uuid references profiles (id) on delete set null,
  previous_due_date date not null,
  -- clock time, not transaction time: two doses in one transaction still have an order.
  created_at timestamptz not null default clock_timestamp()
);
create index vaccine_doses_schedule_idx on vaccine_doses (pet_vaccine_id, created_at desc);

-- ---------------------------------------------------------------- RLS
alter table vaccines enable row level security;
alter table pet_vaccines enable row level security;
alter table vaccine_doses enable row level security;

create policy "vaccines_select_staff" on vaccines
  for select using (clinic_id = (select current_user_clinic_id()));
create policy "vaccines_write_manager" on vaccines
  for all using (clinic_id = (select current_user_clinic_id()) and public.current_user_has_role(array['manager']))
  with check (clinic_id = (select current_user_clinic_id()) and public.current_user_has_role(array['manager']));
create policy "vaccines_all_admin" on vaccines
  for all using (current_user_is_admin());

create policy "pet_vaccines_all_staff" on pet_vaccines
  for all using (clinic_id = (select current_user_clinic_id()))
  with check (
    clinic_id = (select current_user_clinic_id())
    and pet_id in (select id from pets where clinic_id = (select current_user_clinic_id()))
  );
create policy "pet_vaccines_all_admin" on pet_vaccines
  for all using (current_user_is_admin());

-- Doses are read directly but written only through the two functions below.
create policy "vaccine_doses_select_staff" on vaccine_doses
  for select using (clinic_id = (select current_user_clinic_id()));
create policy "vaccine_doses_all_admin" on vaccine_doses
  for all using (current_user_is_admin());
revoke insert, update, delete on vaccine_doses from anon, authenticated;

-- ---------------------------------------------------------------- doses
create function public.mark_vaccine_given(p_pet_vaccine uuid, p_given_on date default null)
returns date
language plpgsql security definer
set search_path = public
as $$
declare
  v pet_vaccines;
  v_today date;
  v_on date;
begin
  select * into v from pet_vaccines
    where id = p_pet_vaccine and clinic_id = public.current_user_clinic_id() for update;
  if not found then
    raise exception 'Vaccination not found' using errcode = 'P0001';
  end if;
  select (now() at time zone timezone)::date into v_today from clinics where id = v.clinic_id;
  v_on := coalesce(p_given_on, v_today);
  if v_on > v_today then
    raise exception 'A dose can''t be given in the future' using errcode = 'P0001';
  end if;
  insert into vaccine_doses (clinic_id, pet_vaccine_id, given_on, given_by, previous_due_date)
    values (v.clinic_id, v.id, v_on, auth.uid(), v.next_due_date);
  update pet_vaccines set next_due_date = v_on + v.interval_days where id = v.id;
  return v_on + v.interval_days;
end;
$$;

-- Only the latest dose of a schedule can be undone; its due date comes back.
create function public.undo_vaccine_dose(p_dose uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  d vaccine_doses;
begin
  select * into d from vaccine_doses where id = p_dose and clinic_id = public.current_user_clinic_id();
  if not found then
    raise exception 'Dose not found' using errcode = 'P0001';
  end if;
  perform 1 from pet_vaccines where id = d.pet_vaccine_id for update;
  if exists (
    select 1 from vaccine_doses
    where pet_vaccine_id = d.pet_vaccine_id and (created_at, id) > (d.created_at, d.id)
  ) then
    raise exception 'Only the latest dose can be undone' using errcode = 'P0001';
  end if;
  update pet_vaccines set next_due_date = d.previous_due_date where id = d.pet_vaccine_id;
  delete from vaccine_doses where id = d.id;
end;
$$;

revoke execute on function public.mark_vaccine_given(uuid, date) from public, anon;
revoke execute on function public.undo_vaccine_dose(uuid) from public, anon;
grant execute on function public.mark_vaccine_given(uuid, date) to authenticated;
grant execute on function public.undo_vaccine_dose(uuid) to authenticated;

-- ---------------------------------------------------------------- pet cache
create function public.pet_vaccines_sync_pet()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_pet uuid := coalesce(new.pet_id, old.pet_id);
begin
  update pets set next_vaccination_date = (select min(next_due_date) from pet_vaccines where pet_id = v_pet)
    where id = v_pet;
  return null;
end;
$$;

create trigger pet_vaccines_sync_pet
  after insert or update or delete on pet_vaccines
  for each row execute function public.pet_vaccines_sync_pet();

update pets set next_vaccination_date = null;
alter table pets drop column vaccination_interval_days;

notify pgrst, 'reload schema';
