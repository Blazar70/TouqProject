-- Touq / طوق — a visible Pet ID per clinic: 10001, 10002, ...
-- One counter row per clinic, bumped under a row lock, so concurrent inserts
-- never clash and a deleted or purged pet's number is never handed out again
-- (max()+1 would reuse it). The number never changes once given.

create table pet_number_counters (
  clinic_id uuid primary key references clinics (id) on delete cascade,
  last_number integer not null
);

-- Only the security definer trigger below touches it: RLS on, no policies.
alter table pet_number_counters enable row level security;
revoke all on pet_number_counters from anon, authenticated;

alter table pets add column pet_number integer;

-- Existing pets: per clinic, oldest first.
update pets p set pet_number = 10000 + n.rn
from (
  select id, row_number() over (partition by clinic_id order by created_at, id) as rn
  from pets
) n
where n.id = p.id;

insert into pet_number_counters (clinic_id, last_number)
select clinic_id, max(pet_number) from pets group by clinic_id;

alter table pets alter column pet_number set not null;
-- Placeholder only, the trigger below always overwrites it; lets inserts omit the column.
alter table pets alter column pet_number set default 0;
alter table pets add constraint pets_clinic_pet_number_key unique (clinic_id, pet_number);

-- Any client-sent pet_number is ignored.
create function public.assign_pet_number()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into pet_number_counters as c (clinic_id, last_number)
  values (new.clinic_id, 10001)
  on conflict (clinic_id) do update set last_number = c.last_number + 1
  returning last_number into new.pet_number;
  return new;
end;
$$;

create trigger pets_assign_pet_number
  before insert on pets
  for each row execute function public.assign_pet_number();

create function public.prevent_pet_number_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.pet_number is distinct from old.pet_number then
    raise exception 'pet_number cannot be changed';
  end if;
  return new;
end;
$$;

create trigger pets_prevent_pet_number_change
  before update on pets
  for each row execute function public.prevent_pet_number_change();
