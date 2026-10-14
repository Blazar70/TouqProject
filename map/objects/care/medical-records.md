---
type: object
cluster: care
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0001_init.sql
---

# Medical records

The clinical note for a visit. Created when an appointment is completed.

## Why this shape

Completion notes were deliberately written into this table, not new appointment columns, because it is the actual medical file (0008 comment). `appointment_id` was added later so a past appointment can show its visit details (0022).

## Shape

- `pet_id`, `clinic_id`, `vet_id` (not null), `visit_date`, `diagnosis`, `treatment`, `notes`
- `visit_type` check: checkup, vaccination, surgery, emergency, follow_up, grooming, other (0009), mirrored in `src/lib/visitTypes.ts:3`
- `appointment_id` nullable (0022), `photo_url` (0027, stored under a `records/` prefix in the pet-photos bucket)

## Connected to

- **owned-by:** pets (cascade), clinics
- **joins:** appointments (appointment_id), profiles (vet_id)

## If you change this

- **Hits:** the complete flow in AppointmentsPage (`src/pages/AppointmentsPage.tsx:551`), PetDetail history, Dashboard, `admin-manage-clinic` purge.
- **Does not hit:** vaccination schedule. A record with visit type vaccination does NOT update `pets.next_vaccination_date`; that is a separate action in VaccinationPanel.

## Surfaces

| Surface | Role |
|---|---|
| AppointmentsPage | insert on complete |
| PetDetail | reads history |

## See

- Source: `src/lib/database.types.ts:366`
