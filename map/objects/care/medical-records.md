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
- `branch_id` nullable (0046), "seen at"; SessionPage writes the picked branch (phase 3); PetDetail shows "Seen at (branch)" for other branches. Older rows stay null. See [branches](../people/branches.md).
- `appointment_id` nullable (0022), `photo_url` (0027, stored under a `records/` prefix in the pet-photos bucket)
- Per-visit clinical fields, all nullable (0040): `presenting_complaint`, `weight_kg` numeric(6,2) (>0, <2000), `temperature_c` numeric(4,1) (25-45), `heart_rate_bpm` integer (1-400), `physical_exam`, `diagnostic_plan`, `remarks`. Same ranges validated client-side in `src/lib/clinicalFields.ts` (`parseVitals`); keep both in sync.
- New completions write `remarks`, not `notes`; `notes` stays for older records and the PetDetail edit form. Display and print order comes from `visitRecordFields` in `src/lib/clinicalFields.ts`, which skips empty fields.

## Connected to

- **owned-by:** pets (cascade), clinics
- **joins:** appointments (appointment_id), profiles (vet_id)

## If you change this

- **Hits:** the complete flow in AppointmentsPage (`src/pages/AppointmentsPage.tsx`, search `medical_records`), PetDetail history, the printed visit summary (`src/lib/PrintContext.tsx`), `src/lib/clinicalFields.ts`, Dashboard, `admin-manage-clinic` purge.
- **Does not hit:** vaccination schedule. A record with visit type vaccination does NOT update `pets.next_vaccination_date`; that is a separate action in VaccinationPanel.

## Surfaces

| Surface | Role |
|---|---|
| AppointmentsPage | insert on complete |
| PetDetail | reads history |

## See

- Source: `src/lib/database.types.ts:366`
