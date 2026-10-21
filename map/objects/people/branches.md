---
type: object
cluster: people
universe: live
status: verified   # 2026-10-21 @ feature/phase3-branches
entity: supabase/migrations/0044_branches.sql
---

# Branches

A location a clinic works from (table `branches`), plus which clinic accounts work at which branch (table `staff_branches`). Phase 1 of `docs/design/staff-branches-calendar.md` added the tables; phase 2 added staff membership in the UI and admin branch management (0048).

## Why this shape

Branches are a working context, not a wall: all staff see all patients of the clinic (design §7, answer 1). So pets stay clinic-wide; appointments and invoices carry the branch they happened at. Every clinic always has exactly one main branch so the current app, which never sends a branch, keeps working.

## Shape

- `branches`: `clinic_id` (cascade on clinic delete), `name`, `name_ar`, `phone`, `address`, `active` (soft close), `is_main`. One main per clinic: partial unique index `branches_one_main_per_clinic`. `unique (id, clinic_id)` backs the composite FKs below. `supabase/migrations/0044_branches.sql`
- `staff_branches (profile_id, branch_id)`, PK both, cascade on either side. Managers need no rows (see `current_user_branch_ids()` on [profiles](profiles.md)).
- Trigger `clinics_create_main_branch` (after insert on clinics) creates "Main" / "الرئيسي" for every new clinic, so `admin-manage-clinic create` needs no change. 0044 backfilled one main branch per existing clinic and made every existing clinic account a member of it.
- `clinics.timezone` text, default `Asia/Riyadh` (for calendar day bounds, later).
- Branch columns (0046), all composite FKs `(branch_id, clinic_id) -> branches (id, clinic_id)` so a row cannot name another clinic's branch:
  - `appointments.branch_id`, `invoices.branch_id`: not null, backfilled to the main branch. Trigger `fill_default_branch()` (before insert) fills the main branch when none is sent.
  - `medical_records.branch_id` ("seen at"), `pets.home_branch_id`: nullable, not backfilled, no default.
  - Index `appointments_branch_scheduled_idx (branch_id, scheduled_at)`.
- Branch management (0048; managers since 0056): names unique per clinic, case-insensitive, closed ones included (`branches_unique_name_per_clinic`); check `branches_main_is_active` (main can't be closed). Functions `admin_set_main_branch(uuid)` (two updates so there is never zero or two mains) and `admin_close_branch(uuid) returns int` (staff whose only branch it is move to main; all memberships of the closed branch go; returns how many moved). Since 0056 both are `security definer`, allowed for admins and whole-clinic managers of that clinic (`current_user_is_clinic_manager()` = enabled manager with no `staff_branches` rows). Name/phone/address edits and reopen are direct updates.
- RLS: clinic accounts read their clinic's branches and memberships (`branches_select_vet`, `staff_branches_select_vet`); writes: admins (`*_all_admin`); whole-clinic managers insert/update their clinic's branches, branch managers update their own branches (`branches_insert_manager`, `branches_update_manager`, 0056); trigger `branches_enforce_update` stops anyone else changing `active`/`is_main`/`clinic_id`. `clinic-manage-staff` writes memberships with the service role. Manager branch changes are not in `admin_audit_log` (admin-only table).
- Picked branch (phase 3, client only): `BranchContext` (`src/lib/BranchContext.tsx`, rules in `src/lib/branchChoice.ts` + test). Picker after login for 2+ open branches; per tab in sessionStorage, per device in localStorage `touq.branch.<profile id>`, plus `profiles.last_branch_id`. New appointments/invoices send `branch_id` (trigger still fills main when none is sent); new `medical_records` get it as "seen at". Writing only into your own branches is NOT enforced yet (phase 4).
- Rollbacks: `supabase/rollbacks/0056_down.sql`, `0048_down.sql`, then `0046_down.sql`, `0045_down.sql`, `0044_down.sql` (that order). Checks: `supabase/tests/0044_0046_branches_roles_check.sql`, `0048_branch_management_check.sql`, `0056_manager_branches_check.sql` (staging only).

## Connected to

- **owns:** staff_branches
- **owned-by:** clinics
- **joins:** profiles (staff_branches, `last_branch_id`), appointments, invoices, medical_records, pets
- **looks-like-but-is-not:** a clinic. Isolation is still by `clinic_id`; branch never hides data in phase 1.

## If you change this

- **Hits:** `fill_default_branch()` assumes one main branch per clinic; `current_user_branch_ids()`; `admin-manage-clinic` purge (works only because branches cascade from clinics and the branch-carrying rows are deleted before the clinic).
- **Hits (phase 2):** AdminPage branch list/forms and branch checkboxes, StaffPage branch checkboxes, `clinic-manage-staff` (branch checks), staff counts per clinic.
- **Hits (phase 3):** `BranchContext`/`BranchPicker`, AppShell user card + Switch branch, branch filters (`BranchFilter`) on Appointments/Payments/Dashboard, doctor pickers (`worksAt`), `BranchesPanel` (AdminPage + SettingsPage), SessionPage record insert, PetDetail "Seen at".

## Surfaces

| Surface | Role |
|---|---|
| `src/pages/AdminPage.tsx` | per clinic: list, add/edit, make main, close/reopen |
| `src/pages/StaffPage.tsx` | staff branch checkboxes |
| `src/components/BranchPicker.tsx`, `src/lib/BranchContext.tsx` | pick / switch branch |
| `src/components/BranchesPanel.tsx` | list, add/edit, make main, close/reopen (admin + Settings) |

## See

- Source: `supabase/migrations/0044_branches.sql`, `0046_branch_columns.sql`; design `docs/design/staff-branches-calendar.md` §1.3
