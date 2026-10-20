-- Touq / طوق — which branch a row belongs to (phase 1 of
-- docs/design/staff-branches-calendar.md, §1.3). Pets stay clinic-wide so
-- history follows the animal; home_branch_id is only a default.
-- Composite FKs on (branch_id, clinic_id) so a row can never name another
-- clinic's branch.

alter table appointments add column branch_id uuid;
alter table invoices add column branch_id uuid;
alter table medical_records add column branch_id uuid; -- "seen at", optional
alter table pets add column home_branch_id uuid;

alter table appointments add foreign key (branch_id, clinic_id) references branches (id, clinic_id);
alter table invoices add foreign key (branch_id, clinic_id) references branches (id, clinic_id);
alter table medical_records add foreign key (branch_id, clinic_id) references branches (id, clinic_id);
alter table pets add foreign key (home_branch_id, clinic_id) references branches (id, clinic_id);

update appointments a set branch_id = b.id from branches b where b.clinic_id = a.clinic_id and b.is_main;
update invoices i set branch_id = b.id from branches b where b.clinic_id = i.clinic_id and b.is_main;

alter table appointments alter column branch_id set not null;
alter table invoices alter column branch_id set not null;

-- The deployed app sends no branch_id; fill the clinic's main branch so its
-- inserts keep working. Security definer: owner-side inserts on appointments
-- (appointments_all_owner) cannot read branches.
create function public.fill_default_branch()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.branch_id is null then
    select id into new.branch_id from branches where clinic_id = new.clinic_id and is_main;
  end if;
  return new;
end;
$$;

create trigger appointments_fill_default_branch
  before insert on appointments
  for each row execute function public.fill_default_branch();

create trigger invoices_fill_default_branch
  before insert on invoices
  for each row execute function public.fill_default_branch();

create index appointments_branch_scheduled_idx on appointments (branch_id, scheduled_at);
