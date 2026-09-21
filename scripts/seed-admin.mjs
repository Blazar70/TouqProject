// One-off script to create the first admin account, bypassing the public
// signup form entirely. Run with: node scripts/seed-admin.mjs <email> <password> <full name>
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local — this key has full
// admin access to your database and must never be prefixed with VITE_
// (that prefix is what Vite bundles into frontend code shipped to users).
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

const [, , email, password, ...nameParts] = process.argv
const fullName = nameParts.join(' ')

if (!email || !password || !fullName) {
  console.error('Usage: node scripts/seed-admin.mjs <email> <password> <full name>')
  process.exit(1)
}

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

const { data: userData, error: userError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})

if (userError || !userData.user) {
  console.error('Failed to create user:', userError?.message)
  process.exit(1)
}

const { error: profileError } = await supabase.from('profiles').insert({
  id: userData.user.id,
  role: 'admin',
  full_name: fullName,
  clinic_id: null,
})

if (profileError) {
  console.error('User created, but failed to create admin profile:', profileError.message)
  process.exit(1)
}

console.log(`Admin account created: ${email}`)
