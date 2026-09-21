// One-off cleanup helper: deletes an auth user (and their profile row, via
// the FK's on-delete-cascade) by email. Run with:
// node scripts/delete-user-by-email.mjs <email>
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

function loadEnvLocal() {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/)
      if (match) process.env[match[1]] ??= match[2]
    }
  } catch {
    // .env.local not found; rely on already-exported env vars
  }
}
loadEnvLocal()

const [, , email] = process.argv
if (!email) {
  console.error('Usage: node scripts/delete-user-by-email.mjs <email>')
  process.exit(1)
}

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data, error } = await supabase.auth.admin.listUsers()
if (error) {
  console.error('Failed to list users:', error.message)
  process.exit(1)
}

const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
if (!user) {
  console.log(`No user found with email ${email} — nothing to delete.`)
  process.exit(0)
}

const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id)
if (deleteError) {
  console.error('Failed to delete user:', deleteError.message)
  process.exit(1)
}

console.log(`Deleted user ${email} (${user.id})`)
