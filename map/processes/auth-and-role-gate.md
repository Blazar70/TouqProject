---
type: process
status: verified   # 2026-10-14 @ 583fe57
consumes: [profiles, clinics]
produces: []
---

# auth-and-role-gate

Sign in, load the profile and clinic, then choose which route set the user gets.

## Input → Movement → Output

Email + password → Supabase auth → profile and clinic loaded in one query → one of: reset screen, loading, login, disabled-user screen, disabled-clinic screen, admin routes, or clinic routes.

## Why this shape

There is no public signup (0029 removed it). A disabled user can still read their own profile on purpose, so the app can say "disabled" instead of showing empty data.

## Steps

1. `signInWithPassword` or reset email. `src/pages/LoginPage.tsx`. The box takes a username (turned into `<username>@staff.touq.invalid` by `usernameToEmail`) or an email. A banned (removed) account gets error code `user_banned` → `admin.accountDisabledBody`. Logout signs out this device only (`scope: 'local'`). Staff with usernames can't use the reset email; a manager or admin resets their password.
2. `AuthContext` loads `profiles` with `clinics(name, phone, disabled)`. `src/lib/AuthContext.tsx:78`
3. `App` checks in order: password recovery, loading, no session, `profile.disabled`, clinic disabled. `src/App.tsx:29-68`
4. `isAdmin = profile.role === 'admin'` picks admin routes (`/`, `/billing`, `/activity`) or clinic routes (`/`, `/pets`, `/pets/new`, `/appointments`, `/payments`, `/staff`, `/settings`). `src/App.tsx:70,75-93`

The route gate is UI only. The real boundary is RLS.

## Two-step login and idle sign-out

- Two-step login, OFF until v3 (user 10-29; flags `MFA_ENABLED` in `lib/mfa.ts`, `MFA_ENFORCED` in `_shared/aal.ts`; migration parked in `supabase/v3-pending/0095_mfa_required.sql`). When on: admins and managers must sign in with a code (JWT `aal2`). `mfa_ok()` sits inside `current_user_clinic_id()`, `current_user_clinic_role()` and `current_user_is_admin()`, so a password alone reads no clinic data; both staff edge functions refuse non-aal2 admin/manager callers (`_shared/aal.ts`). The app shows `MfaPage` (set up / type code) before the profile opens (`AuthContext.mfaStep`, `lib/mfa.ts`); others opt in under Settings (`TwoStepSettings.tsx`); admin "Reset two-step login" = `admin-manage-clinic` action `reset_mfa`.
- `IdleLogout.tsx`: signs the device out after 10 idle minutes with a one-minute warning; last activity in localStorage so tabs share it and a browser reopened later starts signed out.

## If you change this

- **Hits:** every page, since all sit behind this gate.
- **Does not hit:** RLS policies.

## See

- Objects: [profiles](../objects/people/profiles.md), [clinics](../objects/people/clinics.md)
