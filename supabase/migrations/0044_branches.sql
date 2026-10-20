-- Touq / طوق — branches (phase 1 of docs/design/staff-branches-calendar.md,
-- §1.3). A clinic can work from several locations; every clinic gets one
-- main branch so existing data and the current app need no branch choice.
-- Additive: nothing in the app reads these tables yet.

alter table clinics add column timezone text not null default 'Asia/Riyadh';

create table branches (
  id uuid primary key default gen_random_uuid(),
  -- cascade: admin-manage-clinic purge deletes the clinic row last and does
  -- not know about branches.
  clinic_id uuid not null references clinics (id) on delete cascade,
  name text not null,
  name_ar text,
  phone text,
  address text,
  active boolean not null default true,
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  -- lets branch columns (0046) use a composite FK so a row can never point
  -- at another clinic's branch.
  unique (id, clinic_id)
);

create unique index branches_one_main_per_clinic on branches (clinic_id) where is_main;

-- Managers see all active branches without membership rows (see
-- current_user_branch_ids(), 0045); everyone else works from these.
create table staff_branches (
  profile_id uuid not null references profiles (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  primary key (profile_id, branch_id)
);

-- Every clinic must have a main branch, including ones admin-manage-clinic
-- creates after this migration: fill_default_branch() (0046) relies on it.
create function public.create_main_branch()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into branches (clinic_id, name, name_ar, is_main)
  values (new.id, 'Main', 'الرئيسي', true);
  return new;
end;
$$;

create trigger clinics_create_main_branch
  after insert on clinics
  for each row execute function public.create_main_branch();

insert into branches (clinic_id, name, name_ar, is_main)
select id, 'Main', 'الرئيسي', true from clinics;

insert into staff_branches (profile_id, branch_id)
select p.id, b.id
from profiles p
join branches b on b.clinic_id = p.clinic_id and b.is_main
where p.role = 'vet';

alter table branches enable row level security;
alter table staff_branches enable row level security;

-- Any clinic account reads its clinic's branches and memberships. Writes are
-- admin-only for now; managers get a write path in phase 2 (edge function).
create policy "branches_select_vet" on branches
  for select using (clinic_id = (select current_user_clinic_id()));

create policy "branches_all_admin" on branches
  for all using (current_user_is_admin());

create policy "staff_branches_select_vet" on staff_branches
  for select using (
    branch_id in (select id from branches where clinic_id = (select current_user_clinic_id()))
  );

create policy "staff_branches_all_admin" on staff_branches
  for all using (current_user_is_admin());
