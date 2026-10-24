# effects — if you are changing X, open these

First-order only. Open the card; its "If you change this" has the detail.

| Changing | Open |
|---|---|
| a role, `clinic_id`, or `disabled` logic | [profiles](../objects/people/profiles.md), [auth-and-role-gate](../processes/auth-and-role-gate.md) |
| branches, `clinic_role`, or a branch column | [branches](../objects/people/branches.md), [profiles](../objects/people/profiles.md) |
| anything clinic-scoped, or an RLS helper function | [clinics](../objects/people/clinics.md), then every `*_all_vet` policy |
| a new table with a `clinic_id` | [clinic-lifecycle](../processes/clinic-lifecycle.md) (purge list), [trash-and-purge](../processes/trash-and-purge.md) |
| appointment statuses | [appointments](../objects/care/appointments.md), [push-notifications](../processes/push-notifications.md) |
| cancellation categories | [appointments](../objects/care/appointments.md) (code-only list, no DB check) |
| visit types | [medical-records](../objects/care/medical-records.md) |
| vaccination rules | [pets](../objects/care/pets.md); medical records do not update the schedule |
| staff / assignment | [staff](../objects/people/staff.md), [appointments](../objects/care/appointments.md) |
| anything pet-owner money, visit services, billing a visit | [invoices](../objects/money/invoices.md), [services](../objects/money/services.md) |
| anything clinic-to-Touq money | [payments](../objects/money/payments.md) |
| photo upload or bucket policy | [storage-buckets](../objects/platform/storage-buckets.md) |
| push or reminders | [push](../objects/platform/push.md), [push-notifications](../processes/push-notifications.md) |
| owner messages (WhatsApp reminders) | [owner-reminders](../processes/owner-reminders.md), [owners](../objects/people/owner-files.md) |
| a new admin action string | [admin-audit-log](../objects/platform/admin-audit-log.md) |
| deleting pets, staff or clinics | [trash-and-purge](../processes/trash-and-purge.md) |

## What points into the tree from outside

Not discoverable from the repo. Ask the owner and record here:

- Two timed jobs, both migrations: nightly purge (0077: expired pets with their photos, then expired clinics, via `admin-manage-clinic` `purge_expired`) and reminders every 15 min (0079). They read Vault secrets `touq_project_url` + `cron_purge_secret`; a project without them gets failing job runs (see README step 6).
- Both jobs authenticate with header `x-cron-secret` = function secret `CRON_PURGE_SECRET`; both functions are deployed with `--no-verify-jwt`.
- Function secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_PURGE_SECRET`; env `VITE_VAPID_PUBLIC_KEY`.
- `scripts/*.mjs` use the service-role key and bypass RLS.
