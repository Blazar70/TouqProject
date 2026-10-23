---
type: object
cluster: care
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0001_init.sql
---

# Pets

The animal and the centre of the care cluster. Also carries vaccination scheduling and owner contact info.

## Why this shape

Owner contact is plain text on the pet (0007), because owner logins never took off, so `owner_id` is nullable and unused for most pets. Vaccination is two columns, not a dose-history table, on purpose (0012 comment: "simpler for a v1").

## Shape

- `clinic_id` not null, `owner_id` nullable (old owner logins, unused), `owner_name` not null, `owner_phone`, `owner_email` (0007)
- `owner_file_id` not null (0063) -> [owner-files](../people/owner-files.md), same clinic (composite FK). The owner text columns are a copy kept by triggers: a new pet without an owner file gets one from its text; picking another owner copies its contact; a direct text edit (admin page) edits the owner file. `supabase/migrations/0063_owner_files.sql`
- `species`, `breed`, `date_of_birth`, `photo_url` (0013)
- `pet_number` (0052): the visible Pet ID, per clinic from 10001, never changed or reused. Assigned by trigger `pets_assign_pet_number` from table `pet_number_counters` (RLS on, no client access); `pets_prevent_pet_number_change` blocks edits. Unique `(clinic_id, pet_number)`. Shown in the pets list, pet file, prints and payments; searched via `matchesPetSearch` (`src/lib/appointmentSearch.ts`).
- `home_branch_id` nullable (0046), a default only; pets stay clinic-wide. See [branches](../people/branches.md).
- `next_vaccination_date` (0012): since 0067 a cache of the earliest `pet_vaccines.next_due_date`, kept by trigger; `vaccination_interval_days` dropped in 0067
- `deleted_at` (0032): soft delete, 7 days. RLS does not hide trashed rows; the UI filters with `.is('deleted_at', null)` (`src/pages/PetsPage.tsx:48`).
- Trigger `pets_owner_field_restrictions` stops owners editing anything except name/photo_url. `0025_rls_audit_hardening.sql`

## Connected to

- **owns:** appointments, medical_records, pet_trusted_contacts, invoices (cascade on delete)
- **owned-by:** clinics; optionally profiles (owner)
- **looks-like-but-is-not:** a pet "owner" in the UI is the text fields, not a profile.

## If you change this

- **Hits:** PetsPage, PetPicker, RegisterPetPage, PetDetail, VaccinationPanel, Dashboard vaccinations-due, `AppointmentsPage` pet picker, `PaymentsPage` pet picker, purge cron and `admin-manage-clinic` purge order.
- **Does not hit:** payments (the clinic-to-Touq ledger no longer references pets since 0035).

## Surfaces

| Surface | Role |
|---|---|
| `src/pages/PetsPage.tsx` | list (open pet = `/pets/:id`), trash |
| `src/pages/RegisterPetPage.tsx` | create + photo upload |
| `src/components/PetDetail.tsx` | edit, photo, records |
| `src/components/VaccinationPanel.tsx` | set due date and interval |

## See

- Source: `src/lib/database.types.ts:565`; rules in `src/lib/vaccination.ts`, `src/lib/species.ts`, `src/lib/phone.ts`
