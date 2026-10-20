---
type: object
cluster: people
universe: live
status: verified   # 2026-10-21 @ feature/staff-accounts
entity: supabase/migrations/0001_init.sql
---

# Profiles

One row per login, 1:1 with `auth.users`. Product word: "user". Its `role` drives every access rule.

## Why this shape

Row-level security (RLS: the database itself decides which rows a user may touch) keys off `profiles.role` and `clinic_id`, so a mistake here is a security mistake, not a UI one.

## Shape

- `role` enum `user_role`: `vet`, `owner`, `admin` (admin added in 0004). `supabase/migrations/0001_init.sql:22`, `0004_admin_role.sql:9`
- `clinic_id` set for vets, null for owners/admin. `0001_init.sql:24`
- `disabled` boolean (0028). Disabled users can still read their own profile so the app can show a message.
- `push_reminder_lead_minutes`, `push_notify_statuses` (0023): per-user push preferences.
- Trigger `profiles_self_update_restrictions` blocks non-admins from changing role/clinic_id/disabled (0029), clinic_role/takes_appointments/title/calendar_order (0045), username (0047) and email (0049). Since 0047 it lets `auth.role() = 'service_role'` through, so the staff edge functions can write. A plain psql session (no JWT claims) is blocked too: set `request.jwt.claims` to `{"role":"service_role"}` for one-off fixes.
- Login columns: `username` (unique, 0047) and `email` (unique, lower-case, 0049; only real emails, never the synthetic `@staff.touq.invalid` ones). See [staff](staff.md).
- Clinic roles (0045, `supabase/migrations/0045_clinic_roles.sql`): `clinic_role` manager/doctor/nurse/receptionist, required when `role = 'vet'` (check `profiles_vet_has_clinic_role`); `takes_appointments` (gets a calendar column); `title`; `calendar_order`; `last_branch_id` (branch picker pre-fill only, self-editable, set null if the branch goes).
- Trigger `profiles_fill_default_clinic_role` (before insert): a `vet` row sent without `clinic_role` becomes `manager` if it is the clinic's first account, else `doctor` with `takes_appointments`. Keeps `admin-manage-clinic` working unchanged. 0045 backfilled the same rule by `created_at` (to be confirmed with the clinic).
- Helpers (0045, security definer, null/empty when the user or clinic is disabled, like `current_user_clinic_id()`): `current_user_clinic_role()`, `current_user_has_role(text[])`, `current_user_branch_ids()` (setof uuid: their active member branches; a manager with no member rows gets every active branch, 0047). No policy uses them yet.
- Self-signup was removed in 0029; accounts are created only by edge functions: `admin-manage-clinic` (`create`: clinic + first manager) and `clinic-manage-staff` (`create_staff`).
- Owner accounts are effectively unused (see note in `0034_payments_owner_optional.sql`).

## Connected to

- **owns:** push_subscriptions, push preferences
- **owned-by:** clinics (via clinic_id); member of [branches](branches.md) via staff_branches
- **joins:** pets.owner_id (nullable), appointments.created_by, medical_records.vet_id, invoices.created_by / verified_by
- **is also:** [staff](staff.md) when `role = 'vet'` (the old `caregivers` table was retired in 0047).

## If you change this

- **Hits:** every RLS policy via `current_user_clinic_id()` and `current_user_is_admin()`; `AuthContext`; route choice in `src/App.tsx`; `admin-manage-clinic`; `clinic-manage-staff`; `notify-status-change`; `send-appointment-reminders`.
- **Does not hit:** pet owners in the UI (text fields on `pets`).

## Surfaces

| Surface | Role |
|---|---|
| `src/lib/AuthContext.tsx:78` | reads own profile + clinic in one query |
| `src/pages/SettingsPage.tsx` | updates own name/phone/push prefs |
| `src/pages/AdminPage.tsx` | admin reads/updates all |

## See

- Source: `supabase/migrations/0001_init.sql`, `src/lib/database.types.ts:634`
