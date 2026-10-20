# Design: staff logins, branches, roles, calendar

Status: proposal, not built. Written 2026-10-14 against `main` @ bacd47b. Background: [map/CLAUDE.md](../../map/CLAUDE.md).
Decided by the clinic: every staff member logs in with a role; after login the user picks the branch they work from; calendar = doctors across, time down, coloured by attendance and payment; testing on a separate staging Supabase project; one branch + PR per phase.

## 0. Facts that shape the design

- `appointments` has no duration. The calendar needs `duration_minutes`.
- Trigger `enforce_profile_self_update_restrictions` (0029) also blocks edge functions: with the service role `auth.uid()` is null, so `current_user_is_admin()` is false. It must let `service_role` through before any function updates a role.
- Vaccinations live in two places: the schedule on `pets`, and past doses as `medical_records` with `visit_type = 'vaccination'`. "Receptionists see vaccinations" means both.
- Both push functions notify every profile in the clinic. With many staff they must narrow to the branch and the doctor.
- Open feature branches to merge first: `feature/services-vat` (migration 0039), `feature/visit-clinical-fields` (0040), `feature/side-navigation`. Next free migration: 0041.

## 1. Data model

### 1.1 Roles

Keep `user_role` (`admin` = Touq staff, `vet` = any clinic account, `owner` unused) so every existing policy keeps working. Add:

| Column on `profiles` | Type | Purpose |
|---|---|---|
| `clinic_role` | text, check in (`manager`,`doctor`,`nurse`,`receptionist`); required when `role='vet'` | Permissions inside the clinic |
| `takes_appointments` | bool (default true for doctor) | Gets a calendar column; a manager who treats patients can too |
| `title` | text | Moved from `caregivers` |
| `calendar_order` | int | Column order |
| `last_branch_id` | uuid | Pre-fills the branch picker only, not security |

Staff leave by `profiles.disabled` (0028), never deletion, because `medical_records.vet_id` and `invoices.created_by` point at them.

### 1.2 Retiring `caregivers`

1. Link (0044): `caregivers.profile_id`, `appointments.doctor_id uuid references profiles on delete set null`. Creating a login for an existing caregiver links it and backfills `doctor_id` from `assigned_staff_id`.
2. Retire (0048, only after the clinic confirms): copy `appointments.legacy_staff_name`, drop `assigned_staff_id` and `caregivers`, remove caregivers from the purge cron.

### 1.3 Branches

```
branches (id, clinic_id, name, name_ar, phone, address, active bool, is_main bool, created_at)
  unique (clinic_id) where is_main
staff_branches (profile_id, branch_id)  -- primary key both
clinics.timezone text not null default 'Asia/Riyadh'
```

Backfill one "Main" branch per clinic; existing clinic accounts become members. Managers see all active branches without rows.

| Table | Branch column |
|---|---|
| appointments | `branch_id not null` |
| invoices | `branch_id not null` |
| medical_records | `branch_id` nullable ("seen at") |
| pets | `home_branch_id` nullable; pets stay clinic-wide so history follows the animal |
| services | none for now (one price list) |
| inpatient_stays (later) | `branch_id not null` → "Other branch" label |

A `before insert` trigger `fill_default_branch()` fills `branch_id` with the main branch when the client sends none, so the currently deployed app keeps working after the migration.

### 1.4 Appointment states

```
requested ─► confirmed ─► arrived ─► in_session ─► completed
    │            │           │
    └─► cancelled◄┘           └─► cancelled (left before being seen)
                 └─► no_show
Undo: arrived→confirmed, no_show→confirmed, in_session→arrived (manager)
Walk-in: insert as 'arrived'. "Start session" = confirmed/arrived → in_session.
```

New `appointments` columns: `duration_minutes int default 30`, `doctor_id`, `branch_id`, `arrived_at`, `started_at`, `ended_at`, `status_changed_at`, `status_changed_by`, `payment_waived bool`.
Trigger `appointments_enforce_transition` rejects disallowed transitions and roles, stamps times with `now()`, records who changed it, and writes `appointment_status_events` (for waiting-time and no-show reports).

### 1.5 Payment state (derived, never stored)

From `invoices.appointment_id`: `waived` if `payment_waived`; `unpaid` if no invoice; `pending_verification` if any invoice is `recorded`; `paid` if all are `verified`. Lives in one view so combined bills (later `invoice_appointments`) only change the view.

## 2. Auth and RLS

### 2.1 Where the chosen branch lives

**Recommended: client state.** A `BranchContext`, remembered per user per device in localStorage; branch-scoped queries add `.eq('branch_id', branchId)`. Rejected: storing it on the profile (two devices overwrite each other), a JWT claim (needs token refresh to switch), a request header (Realtime and Storage don't carry it).
RLS enforces: clinic isolation (as today); writes only into the user's member branches; money reads limited to member branches for non-managers. Clinical reads stay clinic-wide, which is what makes "Other branch" possible.

### 2.2 Helpers (security definer, `set search_path = public`)

| Function | Rule |
|---|---|
| `current_user_clinic_id()` | Unchanged (0031) |
| `current_user_clinic_role()` | Role, null if user or clinic disabled |
| `current_user_has_role(text[])` | Role in list |
| `current_user_branch_ids()` | Managers: all active branches. Others: their member branches. Empty if disabled. |
| `current_user_is_admin()` | Unchanged |

In policies write `(select current_user_clinic_id())` so Postgres computes it once per query, not once per row.

### 2.3 Permission matrix

All rows also limited to the user's clinic. Admin keeps full access.

| Table | Manager | Doctor | Nurse | Receptionist |
|---|---|---|---|---|
| branches | RWD (soft) | R | R | R |
| profiles / staff_branches | R; changes via function | R | R | R |
| pets | RWD (trash) | RW | RW (vaccination, weight) | RW, reads vaccinations, no trash |
| appointments | RWD any branch | R all, W own branch | R all, W status own branch | R all, W own branch |
| status changes | all incl. undo | arrived, in_session, completed, no_show | arrived, in_session | requested↔confirmed, arrived, no_show, cancelled, undo |
| medical_records | RWD | RW (own records) | R | R vaccination visits only |
| services | RWD | R | R | R |
| invoices | R all, W, D | R/W own branch | R own branch | R/W own branch |

Built in 0045 by replacing every `*_all_vet` policy with per-command policies in one transaction (policies are OR-ed, so narrowing means removing the broad one). Column rules RLS can't express use triggers, as in 0025/0029.

## 3. Account management

- `admin-manage-clinic`: `create` also makes the Main branch and a `manager`; `add_staff` takes role, branches and optional caregiver to link; new `set_staff_role`, `set_staff_branches`, `set_staff_disabled`; purge order adds `staff_branches` and `branches`.
- New function `clinic-manage-staff` for managers (separate, so a manager can never reach admin actions): `create_staff`, `update_staff`, `set_role`, `set_branches`, `disable`/`enable`, `reset_password`, `link_caregiver`. Guards: no self-demotion or self-disable, managers can't create managers, a clinic always keeps one enabled manager. Logged to `admin_audit_log`.
- Shared user-creation code moves to `supabase/functions/_shared/staff.ts`.
- Staff without email: username stored as a synthetic email; password reset only by manager or admin.

## 4. Calendar

- Columns: active profiles with `takes_appointments` at the branch, ordered by `calendar_order`; plus "Unassigned" and visiting doctors when needed.
- Data: view `appointment_calendar` (`security_invoker`, so it can never show more than the tables), with pet, owner, doctor names, `payment_state`, `invoice_total`; it applies the trashed-pet filter itself. Index `appointments (branch_id, scheduled_at)`. Day bounds from `clinics.timezone`.
- Live: Supabase Realtime on `appointments` filtered by branch; fallback refetch every 30 s.
- Colours (`src/lib/calendarColors.ts`, unit-tested): fill = attendance (requested dashed, booked blue, waiting amber with minutes waited, in session purple, completed green, no-show muted red, cancelled grey and hidden by default); payment = edge band + icon (none unpaid, hatched + clock pending, solid + check paid). Every state also has a text label and icon.
- Tablet: sticky time column and doctor header, CSS logical properties for Arabic. Landscape iPad ~5-7 doctor columns at 160 px; portrait max 3 with doctor chips; phone = agenda list. Tap a block for the actions allowed to your role; tap an empty slot to book. Drag-to-reschedule later.

## 5. Migrations (rollback SQL kept in `supabase/rollbacks/`, rehearsed on staging)

| # | Contents | Additive | Rollback |
|---|---|---|---|
| 0041 | branches, staff_branches, clinics.timezone, backfill | yes | drop |
| 0042 | clinic_role and profile columns, helpers; backfill earliest clinic account → manager (confirm) | yes | drop |
| 0043 | branch columns, `fill_default_branch()`, indexes | yes | drop |
| 0044 | caregiver link, `doctor_id`, profile trigger allows service role | yes | restore 0029 trigger |
| 0045 | role policies (behaviour change) | **no** | `0045_down.sql` recreates every `*_all_vet` |
| 0046 | appointment states, timestamps, events, transition trigger | yes | map new states back, drop |
| 0047 | `appointment_calendar` view, realtime | yes | drop |
| 0048 | retire caregivers (after sign-off) | **no** | backup only |

Later phases, named so nothing above blocks them: inpatient (`inpatient_stays`, `inpatient_updates`, `inpatient_media` in a private bucket), waivers (`waiver_templates`, `pet_waivers` with signature and signed PDF), staff reminders, owner message outbox (channel chosen later), accounting (`invoice_appointments`, invoice numbers per branch, VAT columns, credit notes).

## 6. Phases (one PR each)

0. Prerequisites: merge the three open branches; staging project via `scripts/rebuild-db.mjs`; `scripts/seed-staging.mjs` (2 branches, one user per role); extend `scripts/rls-audit.mjs` into a role × table test.
1. `feature/branches-roles-db`: 0041-0043. No UI; safe on live.
2. `feature/staff-accounts`: 0044, `clinic-manage-staff`, StaffPage rewrite, admin add-staff form.
3. `feature/branch-session` (parallel with 2): BranchContext, branch picker after login, branch filters, "Other branch" badges, branch management in Settings.
4. `feature/role-permissions` (after 2 and 3): 0045, `src/lib/permissions.ts`, nav and button gating. Runs alone.
5. `feature/calendar-states`: 0046-0047, CalendarPage, colours, push recipients narrowed. Calendar UI can be built early in new files.
6. Then inpatient, waivers, reminders, accounting.

## 7. Risks and open questions

Risks: 0045 rewrites every policy (mitigation: role × table test on staging, rehearsed rollback); open iPads running old code after a policy change (add an "update available, reload" prompt before phase 4); trashed pets must stay filtered in every new query.

Questions for the clinic:
1. Is a branch a hard wall (staff never see other branches) or a working context (other branches visible as "Other branch")? The design assumes context.
2. Who is the manager today, do they see patients, and which existing staff records map to which person?
3. Receptionists: is vaccination history enough, or do they need full visit history?
4. May nurses write vitals or notes on visit records now?
5. Do all staff have email, or do some need usernames? May a manager create other managers?
6. One price list for all branches? One VAT registration with invoice numbers per branch? ZATCA e-invoicing requirements?
7. Appointment length: fixed 30 minutes or per service?

Answers from the clinic owner (2026-10-20):
1. **Branches are not a wall.** All staff see all patients of the clinic. Branch matters for **inpatients**: when a staff member records an update on an inpatient pet, the pet's location becomes that staff member's branch. Other branches are shown by their **name**, not as "Other branch". (Supersedes the "Other branch" wording above.)
2. **No manager page exists yet; one is wanted** (future session, scope to be designed).
3. **Receptionists see full visit history** (they need it to answer owners).
4. **Nurses may write vitals and notes.** Which specific fields they must NOT write is still to be defined by the owner.
5. **Everyone logs in with a username + password** (no staff email). **Managers are created only by admins.** Doctors, nurses, receptionists and any role below manager can be created, disabled and deleted by admins **and** managers.
6. **One shared service/price list per clinic** across branches; per-branch prices are an edge case, not built. Invoice numbering / VAT / ZATCA: answered later with the accounting questions.
7. **Appointment length:** realistically varies, but there is no reliable way to know it, so the calendar keeps one fixed block height. Blocks stay colour-coded (status now; attendance + payment colours from §4 when those states exist).

## 8. PWA or website

Keep Touq a PWA (an installable website). On iPad and iPhone, web push only works when the site is installed to the Home Screen, and inpatient reminders need push. Don't build offline data editing: shared live data would conflict. Add an "update available, reload" prompt (switch `registerType` to `prompt`) so new permissions never meet an old open app.
