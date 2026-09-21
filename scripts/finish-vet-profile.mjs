// Completes vet signup for a user whose auth account already exists but is
// missing its profiles row (and clinic), from an interrupted signup.
// Run with: node scripts/finish-vet-profile.mjs <email> <full name> <clinic name>
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

const [, , email, fullName, clinicName] = process.argv
if (!email || !fullName || !clinicName) {
  console.error('Usage: node scripts/finish-vet-profile.mjs <email> <full name> <clinic name>')
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

const { data: clinic, error: clinicError } = await supabase
  .from('clinics')
  .insert({ name: clinicName })
  .select('id')
  .single()

if (clinicError || !clinic) {
  console.error('Failed to create clinic:', clinicError?.message)
  process.exit(1)
}

const { error: profileError } = await supabase.from('profiles').insert({
  id: user.id,
  role: 'vet',
  full_name: fullName,
  clinic_id: clinic.id,
})

if (profileError) {
  console.error('Failed to create profile:', profileError.message)
  process.exit(1)
}

console.log(`Vet profile created for ${email} at clinic "${clinicName}"`)
