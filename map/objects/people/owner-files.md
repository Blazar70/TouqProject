---
type: object
cluster: people
universe: live
status: verified   # 2026-10-22, migrations 0063-0064
entity: supabase/migrations/0063_owner_files.sql
---

# Owner files and balance

The pet owner (customer) of a clinic: contact, notes, pets, and prepaid money.

## Why this shape

Owners used to be text on each pet. 0063 made one file per owner and grouped existing pets by phone (`owner_phone_key()` = `phoneKey()` in `src/lib/phone.ts`); the newest pet gave the name. The pet text columns stay, synced by triggers, so search, prints and old screens did not need rewriting.

## Shape

- `owner_files`: `clinic_id`, `name`, `phone`, `email`, `notes`, `created_at`. Clients may insert/update the contact columns only (column grants); never delete (merge does).
- `owner_balance_entries` (0064): ledger, `kind` top_up / payment / refund / adjustment, signed `amount`, `method` (top-ups), `reason` (adjustments), `invoice_id`, `invoice_payment_id`, `credit_note_id`, `branch_id`, `created_by`. Each insert moves `owner_balances.balance` (one row per owner, created on first entry) under the owner row lock and refuses going below 0 ("Not enough balance (available X)"). Balance = sum of the owner's entries. Clients read only; receptionists and managers only since 0074 (doctors/nurses get 0 rows).
- `owner_balances` (0088; was `owner_files.balance`): `owner_file_id` (PK), `clinic_id`, `balance` (>= 0). Readable by receptionists and managers only (doctors/nurses get no row). App selects embed it as `balance:owner_balances(balance)` and flatten with `flatBalance()` (`src/lib/owners.ts`); Payments and invoices read it directly. Balance entries written by staff need a branch (0088 trigger). Check `supabase/tests/0088_phase4_shortcuts_check.sql`.
- Writers: `add_owner_balance()` (method set = top-up, manager/receptionist; method null = adjustment, manager, reason), triggers on `invoice_payments` (method `balance`) and `credit_notes` (refund_method `balance`), `merge_owner_files()` (pets, ledger, balance move; other file deleted). Merging and moving a pet to another owner (`pets.owner_file_id`) are receptionists/managers only since 0076 (triggers `pets_enforce_owner_move_role`, `owner_files_enforce_merge_role`; buttons hidden via `handlesMoney`). Top-ups, adjustments, merges go to `admin_audit_log` (`balance_top_up`, `balance_adjusted`, `owners_merged`).
- Checks `supabase/tests/0063_*`, `0064_*`; rollbacks `0064_down.sql` then `0063_down.sql`.

## If you change this

- **Hits:** `OwnersPage`, `components/OwnerDetail.tsx`, `OwnerPickerModal`, `RegisterPetPage`, `PetDetail` (change owner), `PaymentsPage` + `InvoiceDetail` (Balance method), `PrintContext` (deposit receipt), clinic purge (cascades from clinics).
- **Does not hit:** reports (top-ups are not in daily totals yet).
- PDPL (0089): managers can "Export owner data" (`src/lib/ownerExport.ts`: bilingual print via printReport + JSON file of owner, pets, visits, vaccines, appointments, invoices, waivers, trusted contacts, balance entries) and "Delete personal data" (`anonymise_owner_file()`: name → "Deleted owner #xxxxxx", phone/email/notes cleared and synced to pets, trusted contacts deleted, `owner_files.anonymised_at` set, logged as `owner_anonymised` with the anonymous label only). Kept on purpose: pets + medical history, invoices as issued (ZATCA forbids editing issued invoices; tax invoices print the pet, not the owner), signed waivers (legal evidence). Check `supabase/tests/0089_owner_anonymise_check.sql`. No privacy notice or marketing consent in the app (user 10-25: the clinic handles the notice on paper; consent when marketing exists).
