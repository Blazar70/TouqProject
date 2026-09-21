// Completes admin seeding for a user whose auth account already exists but
// is missing its profiles row (from an earlier failed attempt).
// Run with: node scripts/finish-admin-profile.mjs <email> <full name>
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

function loadEnvLocal() {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match) process.env[match[1]] ??= match[2]
  }
}
loadEnvLocal()

const [, , email, ...nameParts] = process.argv
const fullName = nameParts.join(' ')
if (!email || !fullName) {
  console.error('Usage: node scripts/finish-admin-profile.mjs <email> <full name>')
  process.exit(1)
}

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: usersData, error: listError } = await supabase.auth.admin.listUsers()
if (listError) {
  console.error('Failed to list users:', listError.message)
  process.exit(1)
}

const user = usersData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
if (!user) {
  console.error(`No auth user found for ${email}`)
  process.exit(1)
}

const { data: existingProfile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
if (existingProfile) {
  console.log(`Profile already exists for ${email} — nothing to do.`)
  process.exit(0)
}

const { error: insertError } = await supabase.from('profiles').insert({
  id: user.id,
  role: 'admin',
  full_name: fullName,
  clinic_id: null,
})

if (insertError) {
  console.error('Failed to create profile:', insertError.message)
  process.exit(1)
}

console.log(`Admin profile created for ${email}`)
