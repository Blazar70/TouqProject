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

1. `signInWithPassword` or reset email. `src/pages/LoginPage.tsx:25,35`
2. `AuthContext` loads `profiles` with `clinics(name, phone, disabled)`. `src/lib/AuthContext.tsx:78`
3. `App` checks in order: password recovery, loading, no session, `profile.disabled`, clinic disabled. `src/App.tsx:30-69`
4. `isAdmin = profile.role === 'admin'` picks admin routes (`/`, `/billing`, `/activity`) or clinic routes (`/`, `/pets`, `/pets/new`, `/appointments`, `/payments`, `/staff`, `/settings`). `src/App.tsx:71,111-129`

The route gate is UI only. The real boundary is RLS.

## If you change this

- **Hits:** every page, since all sit behind this gate.
- **Does not hit:** RLS policies.

## See

- Objects: [profiles](../objects/people/profiles.md), [clinics](../objects/people/clinics.md)
