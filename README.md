# Touq (طوق)

Bilingual (English / Arabic) PWA for vet clinics: pets, appointments, medical records, and payments. React + TypeScript + Vite on the front end, Supabase (Postgres, Auth, Storage, Edge Functions) on the back end.

For how the code fits together and what a change touches, start at [map/CLAUDE.md](map/CLAUDE.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | type-check and production build |
| `npm test` | unit tests (vitest) |
| `npm run lint` | oxlint |

## Rebuilding from scratch

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (scripts only; never expose it to the front end).
3. Create a Supabase project, add its connection string as `DATABASE_URL` in `.env.local`, then build the schema (needs `psql`):
   `node scripts/rebuild-db.mjs` (dry run, prints the order) then `node scripts/rebuild-db.mjs --apply`.
   It runs every migration in order, each in its own transaction, and refuses a non-empty database. Do not use `supabase db push`: it skips `0004b` and `0005b`. `0014`-`0019` are photo-storage policy experiments; the end state is `0020`.
4. The `pet-photos` bucket is created by migration 0013. `scripts/create-pet-photos-bucket.mjs` is only a fallback.
5. Deploy the edge functions in `supabase/functions/` and set their secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_PURGE_SECRET`.
6. Schedule the two timed jobs that are not migrations because they embed secrets: see `supabase/cron/*.sql.example`.
7. Create the first admin: `node scripts/seed-admin.mjs <email> <password> <full name>`. There is no public signup; admins create clinics from the Admin page.
8. Optional: `node scripts/rls-audit.mjs` seeds a throwaway second clinic and test accounts, then checks that clinics cannot see each other's data. Run it after any RLS change.

## Layout

| Path | What it holds |
|---|---|
| `src/pages`, `src/components` | UI |
| `src/lib` | auth, i18n, and business rules |
| `supabase/migrations` | schema, applied in order; never edit an old one, add a new one |
| `supabase/functions` | edge functions (clinic admin, push) |
| `supabase/cron` | job templates to run by hand |
| `scripts` | one-off admin tools (use the service-role key) |
| `map` | navigation map for people and agents |
