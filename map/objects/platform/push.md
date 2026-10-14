---
type: object
cluster: platform
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0023_push_notifications.sql
---

# Push subscriptions and reminder log

One browser or device registration per row, plus a dedupe log for reminders.

## Shape

- `push_subscriptions`: `profile_id`, `endpoint` unique, `p256dh`, `auth`. Policy: own rows only.
- `appointment_reminders_sent`: composite key (appointment_id, profile_id). No policies; service role only. This is the guard that stops the 15-minute job re-sending.
- Preferences live on `profiles` (lead minutes, notify statuses).
- Dead endpoints (404/410) are deleted by `sendToSubscriptions` in `supabase/functions/_shared/push.ts`, used by both functions.

## Connected to

- **owned-by:** profiles

## If you change this

- **Hits:** `src/lib/push.ts`, SettingsPage, both push edge functions, `src/sw.ts`, `VITE_VAPID_PUBLIC_KEY` plus `VAPID_*` function secrets.
- **Does not hit:** appointments data.

## See

- Process: [push-notifications](../../processes/push-notifications.md)
- Source: `src/lib/database.types.ts:678, 65`
