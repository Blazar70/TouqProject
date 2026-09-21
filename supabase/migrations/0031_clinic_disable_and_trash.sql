-- Touq / طوق — clinic-level disable (blocks every vet/staff at that clinic
-- regardless of their own profile.disabled) plus a 7-day trash window for
-- clinic deletion instead of deleting immediately.

alter table clinics add column disabled boolean not null default false;
alter table clinics add column deleted_at timestamptz;

-- current_user_clinic_id() already backs every *_all_vet policy (pets,
-- caregivers, appointments, medical_records, payments) and clinics_select_vet
-- — gating it on the clinic's own `disabled` here blocks all of those at
-- once for every staff member at that clinic, the same way 0028 blocked a
-- single disabled profile. Trashing a clinic sets `disabled = true`, so a
-- trashed clinic is fully inaccessible immediately, not just pending purge.
create or replace function public.current_user_clinic_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select p.clinic_id
  from profiles p
  join clinics c on c.id = p.clinic_id
  where p.id = auth.uid() and p.role = 'vet' and not p.disabled and not c.disabled;
$$;

-- A vet's own clinic must stay readable even while disabled — otherwise
-- AuthContext can't fetch the clinic's name/disabled flag to show a clear
-- "your clinic has been disabled" screen instead of the app just going
-- silently empty. Deliberately independent of current_user_clinic_id()'s
-- disabled gate above.
create policy "clinics_select_own_vet_regardless_disabled" on clinics
  for select using (
    id = (select clinic_id from profiles where id = auth.uid() and role = 'vet')
  );
