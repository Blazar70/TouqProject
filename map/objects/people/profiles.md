---
type: object
cluster: people
universe: live
status: verified   # 2026-10-14 @ 583fe57
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
- Trigger `profiles_self_update_restrictions` blocks non-admins from changing role/clinic_id/disabled. `0029_admin_only_onboarding.sql`
- Self-signup was removed in 0029; accounts are created only by the `admin-manage-clinic` edge function.
- Owner accounts are effectively unused (see note in `0034_payments_owner_optional.sql`).

## Connected to

- **owns:** push_subscriptions, push preferences
- **owned-by:** clinics (via clinic_id)
- **joins:** pets.owner_id (nullable), appointments.created_by, medical_records.vet_id, invoices.created_by / verified_by
- **looks-like-but-is-not:** staff. Staff are in `caregivers`, which have no login.

## If you change this

- **Hits:** every RLS policy via `current_user_clinic_id()` and `current_user_is_admin()`; `AuthContext`; route choice in `src/App.tsx`; `admin-manage-clinic`; `notify-status-change`; `send-appointment-reminders`.
- **Does not hit:** caregivers (separate table, no auth link).

## Surfaces

| Surface | Role |
|---|---|
| `src/lib/AuthContext.tsx:78` | reads own profile + clinic in one query |
| `src/pages/SettingsPage.tsx` | updates own name/phone/push prefs |
| `src/pages/AdminPage.tsx` | admin reads/updates all |

## See

- Source: `supabase/migrations/0001_init.sql`, `src/lib/database.types.ts:634`
