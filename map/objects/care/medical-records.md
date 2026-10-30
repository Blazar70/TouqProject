---
type: object
cluster: care
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0001_init.sql
---

# Medical records

The clinical note for a visit. One per session, saved as the session goes (SessionPage Save / Finish, and by itself 5 s after the last change since 10-30, nightly H41: status line "Saved 10:42" / "Not saved yet: <vitals problem>") and shared by the doctor and the nurse (0075).

## Why this shape

Completion notes were deliberately written into this table, not new appointment columns, because it is the actual medical file (0008 comment). `appointment_id` was added later so a past appointment can show its visit details (0022).

## Shape

- `pet_id`, `clinic_id`, `vet_id` (the doctor; nullable since 0075 for a nurse-only visit), `nurse_id` (0075, the nurse co-author), `visit_date`, `diagnosis`, `treatment`, `notes`
- `visit_type` check: checkup, vaccination, surgery, emergency, follow_up, grooming, other (0009), mirrored in `src/lib/visitTypes.ts:3`
- `branch_id` nullable (0046), "seen at"; SessionPage writes the picked branch (phase 3); PetDetail shows "Seen at (branch)" for other branches. Older rows stay null. See [branches](../people/branches.md).
- `appointment_id` nullable (0022), `photo_url` (0027, stored under a `records/` prefix in the pet-photos bucket)
- Per-visit clinical fields, all nullable (0040): `presenting_complaint`, `weight_kg` numeric(6,2) (>0, <2000), `temperature_c` numeric(4,1) (25-45), `heart_rate_bpm` integer (1-400), `physical_exam`, `diagnostic_plan`, `remarks`. Same ranges validated client-side in `src/lib/clinicalFields.ts` (`parseVitals`); keep both in sync.
- New completions write `remarks`, not `notes`; `notes` stays for older records and the PetDetail edit form. Display and print order comes from `visitRecordFields` in `src/lib/clinicalFields.ts`, which skips empty fields.

## Who writes what (0075, trigger `enforce_medical_record_roles`)

- Authors are set by the DB from who writes, never by the client.
- Nurses: everything except `diagnosis`, `treatment`, `diagnostic_plan`; no deletes; no edits to a doctor's record once its visit is not in session. UI hides those fields/buttons (SessionPage, PetDetail) via `isDoctorOnlyField` in `src/lib/clinicalFields.ts`.
- While its appointment is in session, only `can_work_session()` people write it (starter + clinicians of the other role).
- Admins and server code (no auth.uid()) skip the rules. Check `supabase/tests/0075_session_nurse_roles_check.sql`, rollback `0075_down.sql`.

## Connected to

- **owned-by:** pets (cascade), clinics
- **joins:** appointments (appointment_id), profiles (vet_id)

## If you change this

- **Hits:** the complete flow in AppointmentsPage (`src/pages/AppointmentsPage.tsx`, search `medical_records`), PetDetail history, the printed visit summary (`src/lib/PrintContext.tsx`), `src/lib/clinicalFields.ts`, Dashboard, `admin-manage-clinic` purge.
- **Does not hit:** vaccination schedule. A record with visit type vaccination does NOT update `pets.next_vaccination_date`; that is a separate action in VaccinationPanel.

## Surfaces

| Surface | Role |
|---|---|
| SessionPage | insert/update during the session (Save, Finish) |
| PetDetail | reads history |

## See

- Source: `src/lib/database.types.ts:366`
- 0087: only doctors, nurses (0075 limits) and managers may add, edit or delete visit records (`enforce_medical_record_roles`); receptionists read them and see Print only on the pet file.
- 0088: one visit record per appointment (`medical_records_one_per_visit`; SessionPage saves into the other person's record on a clash); nurses can't change the pre-0040 Notes field (hidden for them); prints show the nurse next to the doctor.
- 0096: `prescription` jsonb = medicine lines `{medicine, dose, frequency, duration, note}` (free text; doctors/managers only, nurses refused like the diagnosis; `PrescriptionEditor.tsx`, shown/printed via `visitRecordFields`). Weight history from records + inpatient updates draws `WeightChart.tsx` on the pet file (clinicians only).
- Prescription extras (10-30, no migration): quick-pick buttons for how often / how long and "Repeat last prescription" (the pet's newest prescription from another visit, SessionPage only) in `PrescriptionEditor.tsx`; "Print prescription" on the pet file record and the appointment panel prints the prescription alone (`PrintContext.printPrescription`, one page with a doctor line).
- 0096: `visit_templates` = clinic-wide ready-made record texts + prescription; doctors/managers write (Settings > Visit templates, `VisitTemplatesSettings.tsx`), clinicians read and apply at the top of SessionPage (`TemplatePicker.tsx`, `lib/visitTemplates.ts`).
