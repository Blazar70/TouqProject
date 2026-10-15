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
| DB schema | `supabase/migrations/` (0001-0042, applied in order) |
| Generated DB types | `src/lib/database.types.ts` |
| Edge functions | `supabase/functions/` |

## Name collisions (product word vs code word)

- **Staff** = table `caregivers` (0010). Not `profiles`. Staff have no login.
- **Payments page** (clinic side) = table `invoices`. Table `payments` is the clinic paying Touq (admin only).
- **Vet** = `user_role = 'vet'`. Roles are `vet`, `owner`, `admin`. Owner accounts are effectively unused.
- **Pet owner** in the UI = text fields on `pets`, not a profile.
- **Vaccination** = columns on `pets`, not a table.
- **Trash** = soft delete (`deleted_at`), 7 days, UI-filtered for pets and staff.

## Route by task

| If you are | Go to |
|---|---|
| asking "what is X" | `objects/_index.md`, then the card |
| about to change something | `effects/CONTEXT.md` |
| changing a table or policy | the card, then add a new numbered migration; never edit an old one |
| touching text shown to users | `src/lib/i18n/translations.ts` (both languages) |

## The one rule

Cite source. If a card and the code disagree, the code wins and the card gets fixed.
