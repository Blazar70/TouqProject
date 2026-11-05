-- Clinic diagnosis list (nightly research AD; user 11-05). A short bilingual list per clinic: doctors and managers
-- keep it in Settings, doctors pick from it above the free-text diagnosis, and a manager report counts visits per term.
-- Terms are archived, never deleted, so old visits stay counted.
create table diagnosis_terms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  name_en text not null check (btrim(name_en) <> '' and length(name_en) <= 100),
  name_ar text not null check (btrim(name_ar) <> '' and length(name_ar) <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);
create unique index diagnosis_terms_clinic_en_idx on diagnosis_terms (clinic_id, lower(btrim(name_en)));
create unique index diagnosis_terms_clinic_ar_idx on diagnosis_terms (clinic_id, lower(btrim(name_ar)));

alter table diagnosis_terms enable row level security;
create policy diagnosis_terms_all_admin on diagnosis_terms for all using (public.current_user_is_admin());
create policy diagnosis_terms_select_clinicians on diagnosis_terms for select
  using (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['doctor', 'nurse', 'manager'])));
create policy diagnosis_terms_insert_doctors on diagnosis_terms for insert
  with check (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['doctor', 'manager'])));
create policy diagnosis_terms_update_doctors on diagnosis_terms for update
  using (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['doctor', 'manager'])))
  with check (clinic_id = (select public.current_user_clinic_id()));
revoke all on diagnosis_terms from anon;
grant select, insert, update on diagnosis_terms to authenticated;
grant all on diagnosis_terms to service_role;

alter table medical_records
  add column diagnosis_term_id uuid,
  add constraint medical_records_diagnosis_term_fkey foreign key (diagnosis_term_id, clinic_id)
    references diagnosis_terms (id, clinic_id) on delete set null (diagnosis_term_id);
create index medical_records_diagnosis_term_idx on medical_records (diagnosis_term_id) where diagnosis_term_id is not null;

-- The link follows the diagnosis text, so picking, typing the exact term and visit templates all count, and the
-- client can't set it. Unchanged text keeps its link, so renaming a term keeps its old visits.
-- shortcut: visits typed before a term was added stay under "typed by hand"; add a re-link on insert if clinics ask.
create function public.medical_records_match_term()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.diagnosis is not distinct from old.diagnosis then
    new.diagnosis_term_id := old.diagnosis_term_id;
    return new;
  end if;
  new.diagnosis_term_id := (
    select t.id from diagnosis_terms t
    where t.clinic_id = new.clinic_id
      and lower(btrim(new.diagnosis)) in (lower(btrim(t.name_en)), lower(btrim(t.name_ar)))
    order by t.active desc
    limit 1
  );
  return new;
end;
$$;

create trigger medical_records_match_term before insert or update of diagnosis, diagnosis_term_id on medical_records
  for each row execute function public.medical_records_match_term();

create function public.report_top_diagnoses(p_from date, p_to date, p_branch uuid default null)
returns table (term_id uuid, name_en text, name_ar text, visits bigint)
language sql stable security invoker
set search_path = public
as $$
  select public.require_clinic_role(array['manager'], 'Only managers can see income and VAT reports');
  with c as (select * from public.report_bounds(p_from, p_to))
  select m.diagnosis_term_id, t.name_en, t.name_ar, count(*)
  from medical_records m
  join c on m.clinic_id = c.clinic_id and m.visit_date >= c.t0 and m.visit_date < c.t1
  left join diagnosis_terms t on t.id = m.diagnosis_term_id
  where btrim(coalesce(m.diagnosis, '')) <> '' and (p_branch is null or m.branch_id = p_branch)
  group by m.diagnosis_term_id, t.name_en, t.name_ar
  order by m.diagnosis_term_id is null, count(*) desc, t.name_en;
$$;
revoke execute on function public.report_top_diagnoses(date, date, uuid) from public, anon;
grant execute on function public.report_top_diagnoses(date, date, uuid) to authenticated, service_role;
