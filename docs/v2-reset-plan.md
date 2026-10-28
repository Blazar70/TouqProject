# v2 data reset — plan (not run yet)

When: after the user approves v2 (real-device tests + walkthrough + §3 choices done).
Goal: an empty Touq with the full schema (migrations 0001–0094), ready for v3. No test owners, pets, bills or accounts left.

## Open questions (answer before running)
1. **Which database?** Recommended: STAGING only. Live (`kpntxfdcgnbghcherhup`) stays untouched until the go-live rollout, which is planned separately.
2. **Keep the admin account?** Recommended: yes, keep `staging.admin` (or make a fresh admin with `scripts/seed-admin.mjs` afterwards). Every other account goes.
3. **Rebuild a small test clinic afterwards** for v3 work? Recommended: yes, one clinic with one account per role, made fresh, so the sweep scripts work again (their ids point at the demo clinic and must be updated either way).

## Way to do it
Option A (recommended): **wipe the rows, keep the schema.** One SQL script inside a transaction:
- `truncate` every app table with `restart identity cascade` (the clinics → branches → everything chain is handled by `cascade`, and the invoice/pet number counters restart at 1).
- Delete every `auth.users` row except the kept admin (and that admin's `profiles` row stays).
- Storage files can't be deleted from SQL (`storage.protect_delete`): empty the 4 buckets with a small Node script through the Storage API: `pet-photos`, `payment-documents`, `clinic-logos`, `inpatient-media`. Keep the buckets themselves.
- Clear `push_subscriptions` (in the truncate) so no device keeps getting pushes.
- Cron jobs, Vault secrets, edge functions and API keys are not data: leave them.

Option B: a new empty Supabase project + `node scripts/rebuild-db.mjs --apply`. It's cleaner, but every secret, key, function, cron job and the Cloudflare build variables have to be set again. That's more work for no real gain on staging.

## Steps (Option A)
1. Take a backup first: `pg_dump` of staging to a local file (git-ignored), so a wrong reset can be undone.
2. Dry run: run the script inside `begin; … rollback;`, then print the row counts per table (all 0 expected except the admin's `profiles` row).
3. Run it for real (`commit`). Then empty the 4 buckets with the Node script.
4. Check: log in as the admin → the admin dashboard shows 0 clinics; the staging site loads with no console errors; Sentry gets no new errors.
5. If the answer to question 3 was yes: create the test clinic + role accounts, then update the ids and logins in `scripts/sweep/` and `.env.sweep.local`.
6. Update HANDOFF.md: remove the demo clinic, staging test data and old logins sections; record the reset date.

## Table list (from the migrations, 39 tables)
admin_audit_log, appointment_reminders_sent, appointment_services, appointments, branches, caregivers, cash_counts, clinics, credit_notes, doctor_time_off, inpatient_stays, inpatient_task_alerts_sent, inpatient_task_doses, inpatient_tasks, inpatient_updates, invoice_counters, invoice_items, invoice_payments, invoices, medical_records, owner_balance_entries, owner_balances, owner_files, owner_reminders_sent, ownership_transfers, payments, pet_number_counters, pet_trusted_contacts, pet_vaccines, pet_waivers, pets, profiles (all but the admin), push_subscriptions, services, staff_branches, vaccine_doses, vaccines, waiver_templates.
Check before running: whether `admin_audit_log` should be kept (it's the admin's own history), and whether any table was added after 0094.
