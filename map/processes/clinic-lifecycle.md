---
type: process
status: verified   # 2026-10-14 @ 583fe57
consumes: [clinics, profiles]
produces: [clinics, profiles, admin-audit-log]
---

# clinic-lifecycle

An admin creates a clinic with its vet account, adds staff logins, disables, trashes, restores, or purges it.

## Input → Movement → Output

Admin page → `admin-manage-clinic` (service role, admin only) → auth user + profile + clinic rows → audit entry.

## Why this shape

Accounts are created server-side because the old client signup let anyone insert a profile with role admin (0029 comment). Deletion is two-stage: trash disables the clinic immediately, purge happens after 7 days.

## Steps

1. Caller must be an enabled admin. `supabase/functions/admin-manage-clinic/index.ts:46-47`
2. Actions: `create`, `add_staff`, `reset_password`, `trash`, `restore`, `purge`, `purge_expired`. `index.ts:100-257`
3. `create` gets the clinic's main branch from trigger `clinics_create_main_branch`, and the first profile becomes `manager` via `profiles_fill_default_clinic_role` (both 0044/0045, DB-side; the function is unchanged). `create` rolls back the auth user (and clinic) if a later step fails. `index.ts:120-135`
4. `purgeClinic` deletes children in order (including invoices and services), then auth users, then the clinic. `index.ts`, search `purgeClinic`
5. `purge_expired` is callable only with header `x-cron-secret`; the nightly job (0077) sends it; it also purges trashed pets older than 7 days and their photo files.
6. Other admin actions (disable, rename, billing status) go straight to tables from the client and log via `logAdminAction`.

## If you change this

- **Hits:** AdminPage, audit action labels, and any new table with a clinic FK (must be added to `purgeClinic`).
- **Does not hit:** clinic-side pages.

## See

- Objects: [clinics](../objects/people/clinics.md), [profiles](../objects/people/profiles.md), [admin-audit-log](../objects/platform/admin-audit-log.md)
