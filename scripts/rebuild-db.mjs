// Applies supabase/migrations/*.sql, in order, to an EMPTY Supabase database.
//
//   node scripts/rebuild-db.mjs            # dry run: prints the plan only
//   node scripts/rebuild-db.mjs --apply    # actually runs it
//   node scripts/rebuild-db.mjs --apply --from 0002   # resume after a failed file
//
// Why not `supabase db push`: the CLI only recognises files named
// <digits>_<name>.sql, so it silently skips 0004b_ and 0005b_. It also is not
// needed here. This script runs each file with psql in its own invocation
// (its own transaction), which is also what 0004_admin_role.sql requires
// (a new enum value cannot be used in the same transaction that adds it).
//
// Needs: psql on PATH, and DATABASE_URL (Supabase dashboard -> Project
// Settings -> Database -> Connection string, URI form) in the environment or
// in .env.local. The migrations are NOT idempotent, so this refuses to run
// against a database that already has public.profiles.
//
// It does not deploy edge functions, set secrets, or schedule the cron jobs.
// It prints those remaining steps at the end.

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const apply = process.argv.includes('--apply')
// Each file runs in its own transaction, so after a failure the database sits
// exactly after the last good file; --from resumes there.
const fromIndex = process.argv.indexOf('--from')
const from = fromIndex > 0 ? process.argv[fromIndex + 1] : null
const migrationsDir = new URL('../supabase/migrations/', import.meta.url)

function loadEnvLocal() {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // .env.local is optional if DATABASE_URL is already in the environment
  }
}

// Plain code-unit sort, not locale-aware: "0004_admin_role" must come before
// "0004b_admin_policies" ('_' sorts before 'b'), same for 0005 / 0005b.
const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

console.log(`${files.length} migrations, in this order:`)
for (const name of files) console.log(`  ${name}`)

const REMAINING_STEPS = `
After the database is built, these steps remain (not automated, they need your secrets):

  1. Deploy functions:
       supabase functions deploy admin-manage-clinic
       supabase functions deploy notify-status-change
       supabase functions deploy send-appointment-reminders
  2. Set function secrets:
       supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... CRON_PURGE_SECRET=...
  3. Schedule the two jobs: fill in and run, once, in the SQL editor
       supabase/cron/send-appointment-reminders.sql.example
       supabase/cron/purge-expired-clinics.sql.example
  4. Create the first admin:
       node scripts/seed-admin.mjs <email> <password> <full name>
  5. Check isolation between clinics:
       node scripts/rls-audit.mjs
`

if (!apply) {
  console.log('\nDry run. Nothing was executed. Re-run with --apply to build the database.')
  console.log(REMAINING_STEPS)
  process.exit(0)
}

loadEnvLocal()
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('\nDATABASE_URL is not set (environment or .env.local). Aborting.')
  process.exit(1)
}

function psql(args) {
  return spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8' })
}

const probe = psql(['-tA', '-c', "select to_regclass('public.profiles') is not null"])
if (probe.error) {
  console.error('\nCould not run psql:', probe.error.message)
  process.exit(1)
}
if (probe.status !== 0) {
  console.error('\nCould not connect:\n' + probe.stderr)
  process.exit(1)
}
if (probe.stdout.trim() === 't' && !from) {
  console.error('\npublic.profiles already exists. Migrations are not idempotent; refusing to run on a non-empty database.')
  process.exit(1)
}

for (const name of files) {
  if (from && name < from) continue
  process.stdout.write(`applying ${name} ... `)
  const result = psql(['-q', '-1', '-f', fileURLToPath(new URL(name, migrationsDir))])
  if (result.status !== 0) {
    console.log('FAILED')
    console.error(result.stderr)
    console.error(`Stopped at ${name}. Earlier migrations were applied and are not rolled back.`)
    console.error(`Fix it, then resume with: node scripts/rebuild-db.mjs --apply --from ${name.split('_')[0]}`)
    process.exit(1)
  }
  console.log('ok')
}

console.log(REMAINING_STEPS)
