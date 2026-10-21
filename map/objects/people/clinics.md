---
type: object
cluster: people
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0001_init.sql
---

# Clinics

The tenant. Every clinic-owned row (pets, appointments, records, staff, services, invoices) is scoped by `clinic_id`.

## Why this shape

Isolation between clinics is enforced by RLS through one helper, `current_user_clinic_id()`, so disabling or trashing a clinic is a single flag that locks out all its staff at once.

## Shape

- `name`, `phone` (0036, null until a vet fills it in Settings)
- `billing_status` active/trial/overdue/cancelled, manual flag, not wired to a payment processor. `0030_admin_features.sql`
- `disabled` (0031) and `deleted_at` (0031): trash sets both; 7-day window then purge.
- `current_user_clinic_id()` returns null when the clinic is disabled. `0031_clinic_disable_and_trash.sql`
- A vet can still read their own clinic when disabled, so the app can explain why it is empty. `0031` policy `clinics_select_own_vet_regardless_disabled`
- Vets may update their own clinic (0021). Before 0021 the write was silently blocked.
- `timezone` (0044), default `Asia/Riyadh`. Every clinic has one main [branch](branches.md), created by trigger `clinics_create_main_branch` on insert.
- `logo_url` (0053): storage path in the public `clinic-logos` bucket plus `?t=<n>`. Only an admin or an enabled manager of that clinic may change it (trigger `clinics_enforce_logo_update`, helper `can_manage_clinic_logo()`), even though any staff member may update the rest of the row (0021). Shown in the sidebar badge (`AppShell`, via `AuthContext.clinicLogoUrl`), initials when null.
- Per-clinic totals (pets, appointments, staff) for the admin pages come from SQL function `admin_clinic_counts()` (0038), not from counting rows in the browser.

## Connected to

- **owns:** profiles (vets), branches (cascade), pets, appointments, medical_records, services, invoices, payments, admin_audit_log.clinic_id
- **owned-by:** none
- **looks-like-but-is-not:** a row in `payments` is the clinic paying Touq, keyed by clinic_id.

## If you change this

- **Hits:** `current_user_clinic_id()` and thereby every `*_all_vet` policy; `AuthContext`; `admin-manage-clinic` (create/trash/restore/purge); admin Billing page.
- **Does not hit:** owner-side policies, which go through pets.owner_id.

## Surfaces

| Surface | Role |
|---|---|
| `src/pages/AdminDashboardPage.tsx` (`/`) | platform totals, usage chart, billing due |
| `src/pages/AdminPage.tsx` (`/clinics`) | create (via edge function), rename, disable, trash, logo upload/remove |
| `src/pages/SettingsPage.tsx` | vet edits name/phone |
| `src/pages/AdminBillingPage.tsx` | reads, sets billing_status |

## See

- Source: `supabase/migrations/0001_init.sql:12`, `src/lib/database.types.ts:207`
