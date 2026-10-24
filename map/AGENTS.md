# Touq (طوق) — map

Touq is a bilingual (EN/AR) PWA for vet clinics: pets, appointments, medical records, payments. React + Vite + Supabase. This `map/` tells you what the nouns are and what else moves when you change one. The source tree is the truth; the map only points at it.

## Where things live

| Folder | What it holds |
|---|---|
| `objects/_index.md` | one line per noun — start here |
| `objects/<cluster>/` | one card per noun: people, care, money, platform |
| `processes/` | the 5 real movements: auth gate, appointment lifecycle, push, clinic lifecycle, trash and purge |
| `effects/CONTEXT.md` | "if you are changing X, open these cards" |
| `_templates/`, `_meta/schema.md` | blank cards and the rules for them |

## Source map (where the real code is)

| Concern | Path |
|---|---|
| Routes and role gate | `src/App.tsx` (admin vs clinic route sets) |
| Pages | `src/pages/` |
| Business rules | `src/lib/` (cancellation, vaccination, appointmentConflicts, ...) |
| DB schema | `supabase/migrations/` (0001-0075, applied in order; rollbacks in `supabase/rollbacks/`) |
| Generated DB types | `src/lib/database.types.ts` |
| Edge functions | `supabase/functions/` |

## Name collisions (product word vs code word)

- **Staff** = `profiles` with `role = 'vet'` and a `clinic_role` (0047). Every staff member logs in (username or email). The old `caregivers` table is gone.
- **Payments page** (clinic side) = table `invoices`. Table `payments` is the clinic paying Touq (admin only).
- **Vet** = `user_role = 'vet'`. Roles are `vet`, `owner`, `admin`. Owner accounts are effectively unused.
- **Clinic role** = `profiles.clinic_role` (0045): manager / doctor / nurse / receptionist, inside a `vet` account. Role rules live in triggers and functions (`current_user_has_role`), e.g. credit notes 0068, sessions and nurse rules 0075.
- **Branch** = table `branches` (0044), a location of a clinic. Not a data wall: isolation is still by `clinic_id`. The branch someone works at right now is client state (`BranchContext`), not a DB column.
- **Pet owner** = table `owner_files` (0063), the customer, not a profile; `pets.owner_file_id` links it. `pets.owner_name/phone/email` stay as a trigger-synced copy. `pets.owner_id` (-> profiles) is the old unused owner login, not this.
- **Vaccination** = tables `vaccines` (clinic list), `pet_vaccines` (per-pet schedule), `vaccine_doses` (history; written only via `mark_vaccine_given` / `undo_vaccine_dose`, doctors/nurses/managers only since 0075), 0067. `pets.next_vaccination_date` is a trigger-kept cache (earliest due).
- **Trash** = soft delete (`deleted_at`), 7 days, UI-filtered, pets only. Staff are never trashed: removing = disable (`profiles.disabled` + auth ban).

## Route by task

| If you are | Go to |
|---|---|
| asking "what is X" | `objects/_index.md`, then the card |
| about to change something | `effects/CONTEXT.md` |
| changing a table or policy | the card, then add a new numbered migration; never edit an old one |
| touching text shown to users | `src/lib/i18n/translations.ts` (both languages) |

## The one rule

Cite source. If a card and the code disagree, the code wins and the card gets fixed.
