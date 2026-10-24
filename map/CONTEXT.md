# Touq map — how to walk it

Flow in one line: find the noun in `objects/_index.md`, open its card, read "If you change this" before editing; start from `effects/CONTEXT.md` if you already know what you will change.

## Universes

| Universe | Meaning | Touq examples |
|---|---|---|
| live | in force, build against it | tables with UI or function use, pages routed in `src/App.tsx` |
| leftover | present, not the main path | migrations 0014-0019 (photo-storage policy attempts; 0020 is final), `0016_test_wide_open_policy` |
| ghost | named but not wired | `ownership_transfers` |

## Status of cards

`stub` = no body. `verified` needs a date, a commit and citations (all cards are verified at 583fe57, 2026-10-14). `stale` is allowed. Line numbers drift; if a cited line is wrong, re-find it by symbol and fix the card.

## Twins

`AGENTS.md` and `routing.md` are byte-identical copies of `CLAUDE.md`. Edit `CLAUDE.md`, then copy. Never hand-edit the twins.

## Out of scope

The untracked nested `Touq/` folder (own `.git`) is not mapped until the owner says what it is.

## Found while mapping

- Fixed and deployed 2026-10-14: `purgeClinic` skipped `services` and `invoices`; see [services](objects/money/services.md).
- Fixed in repo: both timed jobs were created by hand and absent from the repo; now migrations 0077/0079 with Vault secrets.
- Open by design: trashed pets and staff are hidden by query filters, not RLS, because the Trash view needs to read them; see [trash-and-purge](processes/trash-and-purge.md).
