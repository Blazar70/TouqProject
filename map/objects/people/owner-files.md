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

- `owner_files`: `clinic_id`, `name`, `phone`, `email`, `notes`, `balance` (>= 0, 0064), `created_at`. Clients may insert/update the contact columns only (column grants); never delete (merge does).
- `owner_balance_entries` (0064): ledger, `kind` top_up / payment / refund / adjustment, signed `amount`, `method` (top-ups), `reason` (adjustments), `invoice_id`, `invoice_payment_id`, `credit_note_id`, `branch_id`, `created_by`. Each insert moves `owner_files.balance` under a row lock and refuses going below 0 ("Not enough balance (available X)"). Balance = sum of the owner's entries. Clients read only.
- Writers: `add_owner_balance()` (method set = top-up, manager/receptionist; method null = adjustment, manager, reason), triggers on `invoice_payments` (method `balance`) and `credit_notes` (refund_method `balance`), `merge_owner_files()` (pets, ledger, balance move; other file deleted). Top-ups, adjustments, merges go to `admin_audit_log` (`balance_top_up`, `balance_adjusted`, `owners_merged`).
- Checks `supabase/tests/0063_*`, `0064_*`; rollbacks `0064_down.sql` then `0063_down.sql`.

## If you change this

- **Hits:** `OwnersPage`, `components/OwnerDetail.tsx`, `OwnerPickerModal`, `RegisterPetPage`, `PetDetail` (change owner), `PaymentsPage` + `InvoiceDetail` (Balance method), `PrintContext` (deposit receipt), clinic purge (cascades from clinics).
- **Does not hit:** reports (top-ups are not in daily totals yet).
