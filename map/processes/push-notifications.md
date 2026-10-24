---
type: process
status: verified   # 2026-10-14 @ 583fe57
consumes: [push, appointments, profiles]
produces: [push]
---

# push-notifications

Two senders: a status-change push on demand, and a reminder push on a 15-minute schedule.

## Input → Movement → Output

Status change or timer → edge function (service role) finds recipients by clinic and preference → web push to each subscription → dead endpoints removed; reminders recorded to avoid repeats.

## Why this shape

The status function re-checks that the caller belongs to the appointment's clinic, because it runs with the service key and would otherwise let anyone push for any clinic. `supabase/functions/notify-status-change/index.ts:24-38`

## Steps

1. User opts in: permission, VAPID subscribe, upsert row. `src/lib/push.ts:25`
2. Status push: recipients are clinic profiles whose `push_notify_statuses` include the new status. `notify-status-change/index.ts:40-48`
3. Reminder push: profiles with a lead time; appointments in the next 15 min window; skip if already in `appointment_reminders_sent`. `send-appointment-reminders/index.ts:15-55`
4. The reminder schedule is migration 0079 (every 15 min, `x-cron-secret` from Vault; the function is deployed with `--no-verify-jwt`).

## If you change this

- **Hits:** `push.ts`, `sw.ts`, SettingsPage options, function secrets `VAPID_*`.
- **Does not hit:** appointment data.

## See

- Objects: [push](../objects/platform/push.md)
