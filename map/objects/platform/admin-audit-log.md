---
type: object
cluster: platform
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0030_admin_features.sql
---

# Admin audit log

Who did what to which clinic or user. Admin-only.

## Why this shape

Actor name and target label are denormalized so entries still read after the actor or target is deleted (0030 comment).

## Shape

- `actor_id` (set null), `actor_name`, `action`, `target_type`, `target_label`, `clinic_id` (0033, set null)
- Written from two places: client `logAdminAction` (`src/lib/adminAudit.ts:36`) and the edge function's `logAction` (`supabase/functions/admin-manage-clinic/index.ts:56`).
- Action strings are mapped to labels in `src/lib/adminAudit.ts:6`; a new action needs a label key there and in translations.

## If you change this

- **Hits:** AdminPage activity modal, AdminActivityPage, both writers.
- **Does not hit:** clinic-side pages.

## See

- Source: `src/lib/database.types.ts:17`
