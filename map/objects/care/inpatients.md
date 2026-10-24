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
- Not built yet: billing for the stay, staff medication reminders, viewing updates of past stays.
