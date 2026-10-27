---
type: object
cluster: care
universe: staging
status: verified   # 2026-10-24 @ feature/pc-redesign
entity: supabase/migrations/0081_inpatients.sql
---

# Inpatients

- Tables `inpatient_stays` (pet, branch = where the pet is now, reason, admitted/discharged at+by) and `inpatient_updates` (stay, branch it was written at, author, note, weight/temperature/heart rate, `media` = storage paths). One open stay per pet (`inpatient_stays_one_open`). Migration `0081_inpatients.sql`, check `supabase/tests/0081_inpatients_check.sql`.
- Location rule (clinic answer 2026-10-20): the newest update moves the stay to its branch (trigger `inpatient_updates_move_stay`, security definer; clients can't write `branch_id`). Staff admit and write only at branches they work at (`enforce_branch_write`).
- Roles: doctors + managers admit and discharge; doctors, nurses, managers write updates; everyone reads. Updates are never edited; the author or a manager deletes (the app also removes the files). Discharge can't be undone. Who/when are set by triggers.
- Media: private bucket `inpatient-media`, path `<clinic>/<pet>/<stay>/<uuid>.<ext>`, 30 MB bucket limit (videos), the app keeps photos at 5 MB. Signed URLs for 1 hour.
- UI: `src/components/InpatientPanel.tsx` in the pet file (admit, updates, Copy today as text, discharge, earlier stays by date only), `src/pages/InpatientsPage.tsx` (`/inpatients`, nav Front desk: everyone admitted now, branch filter, latest update). Text builder + day count: `src/lib/inpatient.ts` (+ test).
- **Hits:** pet purge (PetsPage "Delete permanently" and `admin-manage-clinic purge_expired` remove stay media), clinic purge (bucket list), `friendlyError.ts` (already discharged / already admitted).
- Reminders (0082): `inpatient_tasks` ("every N hours from a start", optional end; doctors + managers add and stop, stopping is the only edit), `inpatient_task_doses` (one row per ticked due time; doctors, nurses, managers tick; the ticker or a manager undoes), `inpatient_task_alerts_sent` (push job only). Due times are never stored: `inpatient_task_slots(p_from, p_to)` computes them (app and push job). Discharge ends them. UI `src/components/InpatientReminders.tsx` in the panel; "N due" badge on the Inpatients page. Check `supabase/tests/0082_inpatient_reminders_check.sql`.
- Push: `send-appointment-reminders` (every 15 min, 0079) also sends one push per due, unticked dose of the last hour to doctors + nurses working at the pet's branch (`getsInpatientAlert` in `_shared/alertRecipients.ts`, tested).
- Not built yet: billing for the stay, viewing updates of past stays, a reminder opt-out per person.
- Billing and past stays (0086): a manager picks the price-list service that is one hospital night (`services.hospital_night`, one per clinic; Settings → price list; 0091 trigger: only a manager or admin may set, move or delete it). An earlier stay on the pet file shows its nights, "Show updates" (read-only, same list as the open stay) and "Bill this stay" (reception/managers) → `/payments?stay=<id>` prefills night × `stayNights()`; `create_invoice(p_stay)` accepts only a discharged stay of that pet and `invoices.stay_id` is unique, so a stay is billed once ("Billed · <number>"). Check `supabase/tests/0086_stay_billing_dose_opt_out_check.sql`.
- Dose pushes: each doctor/nurse can switch them off in Settings → Notifications (`profiles.inpatient_dose_push`); `send-appointment-reminders` skips them.
- Discharge outcome (0087): discharge asks Going home / Died / Put to sleep / Transferred (`inpatient_stays.discharge_outcome`, only on a discharged stay). Only "home" gets a pickup reminder; a pet that died or was put to sleep drops off all owner reminders. Older stays have no outcome. Inpatient files: only the uploader, a manager, or anyone after the pet is purged may delete them from storage.
