-- Touq / طوق — phase 6, digital waivers (user decisions 2026-10-25). Managers write templates
-- (English + Arabic text) in Settings; any staff member collects a signature on the pet file:
-- the owner signs with a finger on the clinic tablet and types their name. A signed waiver keeps
-- its own copy of the text (copied here from the template, never sent by the client) and is never
-- edited; a manager may void it with a reason, then a new one is signed. Optional link to a visit
-- or an inpatient stay of the same pet. Printing / "save as PDF" uses the app's print window.

create table waiver_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  title_en text not null check (btrim(title_en) <> ''),
  title_ar text not null check (btrim(title_ar) <> ''),
  body_en text not null check (btrim(body_en) <> ''),
  body_ar text not null check (btrim(body_ar) <> ''),
  -- Offered on the pet file while the pet has an open inpatient stay with no waiver yet.
  suggest_on_admit boolean not null default false,
  -- Templates are archived, not deleted: signed waivers point at them.
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index waiver_templates_clinic on waiver_templates (clinic_id);

create table pet_waivers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  pet_id uuid not null references pets (id) on delete cascade,
  branch_id uuid not null,
  template_id uuid not null references waiver_templates (id) on delete cascade,
  language text not null check (language in ('en', 'ar')),
  title text not null,
  body text not null,
  signer_name text not null check (btrim(signer_name) <> ''),
  -- PNG from the signature pad; data URL only, so it can't point anywhere else.
  signature text not null check (signature like 'data:image/png;base64,%' and length(signature) < 500000),
  appointment_id uuid references appointments (id) on delete set null,
  stay_id uuid references inpatient_stays (id) on delete set null,
  signed_at timestamptz not null default now(),
  collected_by uuid references profiles (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references profiles (id) on delete set null,
  void_reason text,
  check (voided_at is null or btrim(coalesce(void_reason, '')) <> ''),
  foreign key (branch_id, clinic_id) references branches (id, clinic_id)
);
create index pet_waivers_pet on pet_waivers (pet_id, signed_at desc);

alter table waiver_templates enable row level security;
alter table pet_waivers enable row level security;

create policy waiver_templates_all_admin on waiver_templates for all using (public.current_user_is_admin());
create policy waiver_templates_select_staff on waiver_templates for select
  using (clinic_id = (select public.current_user_clinic_id()));
create policy waiver_templates_insert_manager on waiver_templates for insert
  with check (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['manager'])));
create policy waiver_templates_update_manager on waiver_templates for update
  using (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['manager'])))
  with check (clinic_id = (select public.current_user_clinic_id()));
revoke update on waiver_templates from authenticated;
grant update (title_en, title_ar, body_en, body_ar, suggest_on_admit, active) on waiver_templates to authenticated;

create policy pet_waivers_all_admin on pet_waivers for all using (public.current_user_is_admin());
create policy pet_waivers_select_staff on pet_waivers for select
  using (clinic_id = (select public.current_user_clinic_id()));
create policy pet_waivers_insert_staff on pet_waivers for insert
  with check (
    clinic_id = (select public.current_user_clinic_id())
    and (select public.current_user_clinic_role()) is not null
    and pet_id in (select id from pets where clinic_id = (select public.current_user_clinic_id()) and deleted_at is null)
    and template_id in (select id from waiver_templates where clinic_id = (select public.current_user_clinic_id()) and active)
    and voided_at is null
  );
create policy pet_waivers_update_manager on pet_waivers for update
  using (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['manager'])))
  with check (clinic_id = (select public.current_user_clinic_id()));
-- Voiding is the only client edit.
revoke update on pet_waivers from authenticated;
grant update (voided_at, void_reason) on pet_waivers to authenticated;

-- Text, who and when come from the database. Security definer only to read the template.
create function public.fill_pet_waiver()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    select case when new.language = 'ar' then title_ar else title_en end,
           case when new.language = 'ar' then body_ar else body_en end
      into new.title, new.body
      from waiver_templates where id = new.template_id and clinic_id = new.clinic_id;
    if new.title is null then
      raise exception 'Unknown waiver template' using errcode = 'P0001';
    end if;
    if new.appointment_id is not null and not exists (select 1 from appointments where id = new.appointment_id and pet_id = new.pet_id) then
      raise exception 'That visit is not for this pet' using errcode = 'P0001';
    end if;
    if new.stay_id is not null and not exists (select 1 from inpatient_stays where id = new.stay_id and pet_id = new.pet_id) then
      raise exception 'That stay is not for this pet' using errcode = 'P0001';
    end if;
    new.signed_at := now();
    new.collected_by := auth.uid();
  elsif old.voided_at is not null then
    raise exception 'This waiver was already voided' using errcode = 'P0001';
  elsif new.voided_at is not null then
    new.voided_at := now();
    new.voided_by := auth.uid();
  elsif new.void_reason is distinct from old.void_reason then
    raise exception 'A signed waiver can only be voided' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger pet_waivers_fill before insert or update on pet_waivers
  for each row execute function public.fill_pet_waiver();

-- Signed only at a branch the staff member works at (same rule as visit records, 0076).
create trigger pet_waivers_z_branch_write before insert on pet_waivers
  for each row execute function public.enforce_branch_write();
