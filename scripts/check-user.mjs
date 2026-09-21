// Diagnostic: check whether an auth user has a matching profiles row.
// Run with: node scripts/check-user.mjs <email>
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

const [, , email] = process.argv
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: usersData, error: listError } = await supabase.auth.admin.listUsers()
if (listError) {
  console.error('Failed to list users:', listError.message)
  process.exit(1)
}

const user = usersData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
if (!user) {
  console.log(`No auth user found for ${email}`)
  process.exit(0)
}
console.log('Auth user:', { id: user.id, email: user.email, confirmed: !!user.email_confirmed_at })

const { data: profile, error: profileError } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', user.id)
  .maybeSingle()

console.log('Profile:', profileError ?? profile ?? '(none — missing profile row)')
