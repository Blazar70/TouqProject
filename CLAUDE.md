# Touq

Bilingual (EN/AR) vet-clinic PWA. React + Vite + Supabase. Commands: `npm run dev`, `npm test`, `npm run build`, `npm run lint`.

@AGENTS.md

## Where things live

| Folder | What it holds |
|---|---|
| `map/` | catalog of the nouns and what a change hits — read `map/CLAUDE.md` first |
| `src/` | app code |
| `supabase/` | migrations and edge functions |
| `scripts/` | one-off admin tools |

## Route

| If | Go to |
|---|---|
| "what is X" / "what does changing X hit" | `map/CLAUDE.md` |
| schema change | add a new numbered file in `supabase/migrations/` (overrides the `supabase` skill's `migration new` / `db pull --local` workflow: there is no local Supabase project here) |
