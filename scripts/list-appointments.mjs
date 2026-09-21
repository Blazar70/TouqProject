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

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data, error } = await supabase
  .from('appointments')
  .select('id, scheduled_at, status, pets(name)')
  .order('scheduled_at', { ascending: true })

if (error) {
  console.error(error.message)
  process.exit(1)
}

for (const a of data) {
  console.log(a.scheduled_at, a.status, a.pets?.name)
}
