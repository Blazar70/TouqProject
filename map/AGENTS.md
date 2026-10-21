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
| DB schema | `supabase/migrations/` (0001-0055, applied in order; rollbacks in `supabase/rollbacks/`) |
| Generated DB types | `src/lib/database.types.ts` |
| Edge functions | `supabase/functions/` |

## Name collisions (product word vs code word)

- **Staff** = `profiles` with `role = 'vet'` and a `clinic_role` (0047). Every staff member logs in (username or email). The old `caregivers` table is gone.
- **Payments page** (clinic side) = table `invoices`. Table `payments` is the clinic paying Touq (admin only).
- **Vet** = `user_role = 'vet'`. Roles are `vet`, `owner`, `admin`. Owner accounts are effectively unused.
- **Clinic role** = `profiles.clinic_role` (0045): manager / doctor / nurse / receptionist, inside a `vet` account. No policy uses it yet.
- **Branch** = table `branches` (0044), a location of a clinic. Not a data wall: isolation is still by `clinic_id`.
- **Pet owner** in the UI = text fields on `pets`, not a profile.
- **Vaccination** = columns on `pets`, not a table.
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
