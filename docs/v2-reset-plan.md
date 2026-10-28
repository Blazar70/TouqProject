# v2 data reset — plan (not run yet)

When: after the user approves v2 (real-device tests + walkthrough + §3 choices done).
Goal: an empty Touq with the full schema (migrations 0001–0094), ready for v3. No test owners, pets, bills or accounts left.

## Decisions (user 10-28)
1. **Both databases.** Live also holds only dummy data. Live is still at 0046, so bring it to 0094 as part of the planned go-live rollout (HANDOFF §2 item 6, ask first), then wipe it the same way. Never touch live without the user's go-ahead on the day.
2. **Admins are reset too.** Delete every account, including the admins, then create one new admin on each database with `scripts/seed-admin.mjs`. Staging gets a new admin login (record it in HANDOFF). The user gives their own strong credentials for live: never write those into any file.
3. **Rebuild a small test clinic on staging and fill it with data** (one account per role, owners, pets, appointments, bills, a stay), so the sweep scripts work again (update their ids and logins).

## Way to do it
Option A (recommended): **wipe the rows, keep the schema.** One SQL script inside a transaction:
- `truncate` every app table with `restart identity cascade` (the clinics → branches → everything chain is handled by `cascade`, and the invoice/pet number counters restart at 1).
- Delete every `auth.users` row (the admins too), then seed the new admin.
- Storage files can't be deleted from SQL (`storage.protect_delete`): empty the 4 buckets with a small Node script through the Storage API: `pet-photos`, `payment-documents`, `clinic-logos`, `inpatient-media`. Keep the buckets themselves.
- Clear `push_subscriptions` (in the truncate) so no device keeps getting pushes.
- Cron jobs, Vault secrets, edge functions and API keys are not data: leave them.

Option B: a new empty Supabase project + `node scripts/rebuild-db.mjs --apply`. It's cleaner, but every secret, key, function, cron job and the Cloudflare build variables have to be set again. That's more work for no real gain on staging.

## Steps (Option A)
1. Take a backup first: `pg_dump` of staging to a local file (git-ignored), so a wrong reset can be undone.
2. Dry run: run the script inside `begin; … rollback;`, then print the row counts per table (all 0 expected).
3. Run it for real (`commit`). Then empty the 4 buckets with the Node script, then seed the new admin.
4. Check: log in as the new admin → the admin dashboard shows 0 clinics; the site loads with no console errors; Sentry gets no new errors.
5. Staging only: create the test clinic + role accounts + data, then update the ids and logins in `scripts/sweep/` and `.env.sweep.local`.
6. Live: the same steps 1–4, only during the go-live rollout and with the user present.
7. Update HANDOFF.md: remove the demo clinic, staging test data and old logins sections; record the reset date.

## Table list (from the migrations, 39 tables)
admin_audit_log, appointment_reminders_sent, appointment_services, appointments, branches, caregivers, cash_counts, clinics, credit_notes, doctor_time_off, inpatient_stays, inpatient_task_alerts_sent, inpatient_task_doses, inpatient_tasks, inpatient_updates, invoice_counters, invoice_items, invoice_payments, invoices, medical_records, owner_balance_entries, owner_balances, owner_files, owner_reminders_sent, ownership_transfers, payments, pet_number_counters, pet_trusted_contacts, pet_vaccines, pet_waivers, pets, profiles, push_subscriptions, services, staff_branches, vaccine_doses, vaccines, waiver_templates.
Check before running: whether `admin_audit_log` should be kept (it's the admin's own history), and whether any table was added after 0094.
