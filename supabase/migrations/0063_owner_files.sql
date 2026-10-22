-- Touq / طوق — owner files (decided 2026-10-22).
--
-- * One owner file per pet owner (the customer, not staff), per clinic:
--   name, phone, email, notes. Pets point at it with pets.owner_file_id.
--   pets.owner_id is NOT reused: it points at profiles (old owner logins, with
--   their own RLS) and stays as it is.
-- * pets.owner_name / owner_phone / owner_email stay, kept equal to the owner
--   file by triggers, so search, prints, appointments and payments keep working.
--   Editing a pet's owner text directly (admin page) edits the owner file.
--   A pet inserted without an owner file gets a new one from its text fields.
-- * Existing pets are grouped by owner phone within a clinic (same key as
--   src/lib/phone.ts phoneKey: digits after +966, no leading 0, 9 digits).
--   The name and email come from the newest pet; pets without a phone get an
--   owner each.
-- * Same clinic only: the pet -> owner link is a (owner_file_id, clinic_id)
--   foreign key. Owner files are never deleted by clients (merge does it, 0064).

create table owner_files (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);
create index owner_files_clinic_idx on owner_files (clinic_id);

-- Mirror of phoneKey() in src/lib/phone.ts.
create function public.owner_phone_key(p_phone text)
returns text
language sql immutable
set search_path = public
as $$
  select nullif(left(regexp_replace(regexp_replace(regexp_replace(coalesce(p_phone, ''), '^\+966', ''), '\D', '', 'g'), '^0', ''), 9), '');
$$;

-- ---------------------------------------------------------------- backfill
alter table pets add column owner_file_id uuid;

create temp table owner_backfill on commit drop as
select clinic_id, grp, gen_random_uuid() as id,
       (array_agg(owner_name order by created_at desc, id desc))[1] as name,
       case when grp ~ '^5[0-9]{8}$' then '+966' || grp
            else (array_agg(owner_phone order by created_at desc, id desc))[1] end as phone,
       (array_agg(owner_email order by created_at desc, id desc) filter (where nullif(btrim(owner_email), '') is not null))[1] as email,
       min(created_at) as created_at
from (select p.*, coalesce(public.owner_phone_key(p.owner_phone), p.id::text) as grp from pets p) g
group by clinic_id, grp;

insert into owner_files (id, clinic_id, name, phone, email, created_at)
select id, clinic_id, coalesce(nullif(btrim(name), ''), '-'), phone, email, created_at from owner_backfill;

update pets p set owner_file_id = b.id, owner_name = o.name, owner_phone = o.phone, owner_email = o.email
from owner_backfill b
join owner_files o on o.id = b.id
where b.clinic_id = p.clinic_id and b.grp = coalesce(public.owner_phone_key(p.owner_phone), p.id::text);

alter table pets alter column owner_file_id set not null;
alter table pets add constraint pets_owner_file_fkey foreign key (owner_file_id, clinic_id) references owner_files (id, clinic_id);
create index pets_owner_file_idx on pets (owner_file_id);

-- ---------------------------------------------------------------- access
alter table owner_files enable row level security;
create policy "owner_files_select_vet" on owner_files
  for select using (clinic_id = (select current_user_clinic_id()));
create policy "owner_files_insert_vet" on owner_files
  for insert with check (clinic_id = (select current_user_clinic_id()));
create policy "owner_files_update_vet" on owner_files
  for update using (clinic_id = (select current_user_clinic_id())) with check (clinic_id = (select current_user_clinic_id()));
create policy "owner_files_select_admin" on owner_files
  for select using (current_user_is_admin());

-- Contact fields only; the balance (0064) is written by functions alone.
revoke insert, update, delete on owner_files from anon, authenticated;
grant insert (clinic_id, name, phone, email, notes), update (name, phone, email, notes) on owner_files to authenticated;

-- ---------------------------------------------------------------- sync
-- Before a pet is saved: a new pet without an owner gets one from its text;
-- a pet moved to another owner takes that owner's contact.
create function public.pets_sync_owner_file()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_owner owner_files;
begin
  if tg_op = 'INSERT' and new.owner_file_id is null then
    insert into owner_files (clinic_id, name, phone, email)
    values (new.clinic_id, new.owner_name, nullif(btrim(new.owner_phone), ''), nullif(btrim(new.owner_email), ''))
    returning id into new.owner_file_id;
  elsif tg_op = 'INSERT' or new.owner_file_id is distinct from old.owner_file_id then
    select * into v_owner from owner_files where id = new.owner_file_id and clinic_id = new.clinic_id;
    if found then
      new.owner_name := v_owner.name;
      new.owner_phone := v_owner.phone;
      new.owner_email := v_owner.email;
    end if; -- not found: the foreign key refuses it
  end if;
  return new;
end;
$$;

create trigger pets_sync_owner_file
  before insert or update on pets
  for each row execute function public.pets_sync_owner_file();

-- After a direct edit of a pet's owner text (same owner): it edits the owner
-- file, which then updates the owner's other pets. Depth 1 only, so the
-- updates this causes don't loop back.
create function public.pets_push_owner_text()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() = 1 then
    update owner_files set name = new.owner_name, phone = new.owner_phone, email = new.owner_email
    where id = new.owner_file_id;
  end if;
  return null;
end;
$$;

create trigger pets_push_owner_text
  after update of owner_name, owner_phone, owner_email on pets
  for each row
  when (new.owner_file_id = old.owner_file_id
        and (new.owner_name, new.owner_phone, new.owner_email) is distinct from (old.owner_name, old.owner_phone, old.owner_email))
  execute function public.pets_push_owner_text();

create function public.owner_files_sync_pets()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update pets set owner_name = new.name, owner_phone = new.phone, owner_email = new.email
  where owner_file_id = new.id
    and (owner_name, owner_phone, owner_email) is distinct from (new.name, new.phone, new.email);
  return null;
end;
$$;

create trigger owner_files_sync_pets
  after update of name, phone, email on owner_files
  for each row
  when ((new.name, new.phone, new.email) is distinct from (old.name, old.phone, old.email))
  execute function public.owner_files_sync_pets();
