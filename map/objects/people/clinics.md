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
- Vets may update their own clinic (0021). Before 0021 the write was silently blocked. Since 0054 (trigger `clinics_enforce_row_update`) non-admins may change only `name`, `phone` and `logo_url` (plus, for managers since 0061, `vat_number` (Saudi 15 digits 3...3) and `max_staff_discount_percent`, default 10); every other column (billing, disabled, deleted_at, timezone, any new one) is admin-only. Since 0076: `name`/`phone`/`logo_url` managers only, `vat_number`/`max_staff_discount_percent` whole-clinic managers only (branch managers see them read-only in Settings, others see Clinic info read-only). Since 0100 `vat_number` is admin-only again, set with the tax status: `tax_phase` 'none' (not VAT-registered, the default) / 'phase1' (needs `vat_number`, check `clinics_phase1_needs_vat_number`); 'phase2' comes with ZATCA signing in v3 (shown disabled in Admin > Clinics > Edit). `zatca_phase2_date` = the clinic's phase-2 date from ZATCA (stored only). Settings shows both read-only. 'none' hides every VAT field (price list shows one Price; the stored rate stays, so the owner price doesn't change when the clinic registers).
- `timezone` (0044), default `Asia/Riyadh`. Every clinic has one main [branch](branches.md), created by trigger `clinics_create_main_branch` on insert.
- `logo_url` (0053): storage path in the public `clinic-logos` bucket plus `?t=<n>`. Only an admin or an enabled manager of that clinic may change it (trigger `clinics_enforce_logo_update`, helper `can_manage_clinic_logo()`), name/phone are managers only too since 0076. Shown in the sidebar badge (`AppShell`, via `AuthContext.clinicLogoUrl`), initials when null.
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
| `src/pages/SettingsPage.tsx` | managers: logo upload/remove (`ClinicLogoField`, shared with AdminPage) |
| `src/pages/SettingsPage.tsx` | vet edits name/phone |
| `src/pages/AdminBillingPage.tsx` | reads, sets billing_status |

## See

- Source: `supabase/migrations/0001_init.sql:12`, `src/lib/database.types.ts:207`
