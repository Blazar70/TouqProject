// Automated cross-tenant RLS audit. Seeds a throwaway second clinic with a
// vet, two owners, and an admin test account, then verifies — as each of
// those real authenticated roles — that every table's row-level security
// actually isolates them from a different clinic's data the way the app
// depends on. This is an automated version of the manual audit that found
// the `clinics` missing-UPDATE-policy bug earlier in this project; run it
// after any RLS/migration change to make sure that class of bug doesn't
// come back unnoticed.
//
// Requires SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_ANON_KEY in
// .env.local. Seeds and deletes its own data — safe to run against a real
// project, but do not run this against a database you can't afford to
// briefly add throwaway rows to.
//
// Run with: node scripts/rls-audit.mjs
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

const supabaseUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceRoleKey)

const results = []
function check(label, pass, detail) {
  results.push({ label, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? ` (${detail})` : ''}`)
}

function clientAs(accessToken) {
  return createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } } })
}

async function tokenFor(email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Failed to sign in as ${email}: ${JSON.stringify(data)}`)
  return data.access_token
}

const password = 'RlsAudit123!'
const suffix = Date.now()
const emails = {
  vetB: `rls-audit-vet-b-${suffix}@example.com`,
  owner: `rls-audit-owner-${suffix}@example.com`,
  ownerC: `rls-audit-owner-c-${suffix}@example.com`,
  admin: `rls-audit-admin-${suffix}@example.com`,
}

const createdUserIds = []
let clinicBId, clinicAId, petAId, petBId

async function createUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  createdUserIds.push(data.user.id)
  return data.user.id
}

async function cleanup() {
  console.log('\nCleaning up seeded data...')
  if (clinicBId) {
    await admin.from('payments').delete().eq('clinic_id', clinicBId)
    await admin.from('ownership_transfers').delete().eq('pet_id', petBId ?? '00000000-0000-0000-0000-000000000000')
    await admin.from('pet_trusted_contacts').delete().eq('pet_id', petBId ?? '00000000-0000-0000-0000-000000000000')
    await admin.from('medical_records').delete().eq('clinic_id', clinicBId)
    await admin.from('appointments').delete().eq('clinic_id', clinicBId)
    await admin.from('caregivers').delete().eq('clinic_id', clinicBId)
    await admin.from('pets').delete().eq('clinic_id', clinicBId)
  }
  if (createdUserIds.length) {
    await admin.from('profiles').delete().in('id', createdUserIds)
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id)
  }
  if (clinicAId) {
    await admin.from('pets').delete().eq('clinic_id', clinicAId)
    await admin.from('clinics').delete().eq('id', clinicAId)
  }
  if (clinicBId) await admin.from('clinics').delete().eq('id', clinicBId)
  console.log('Cleanup done.')
}

try {
  console.log('Seeding test fixtures...')

  // A real existing clinic to probe against, so this script is self-contained
  // even on a brand-new project with no manually-created test data yet.
  const { data: clinicA } = await admin.from('clinics').insert({ name: 'RLS Audit Clinic A (control)' }).select('id').single()
  clinicAId = clinicA.id
  const { data: petA } = await admin
    .from('pets')
    .insert({ clinic_id: clinicAId, name: 'AuditPetA', species: 'Cat', owner_name: 'Audit Owner A' })
    .select('id')
    .single()
  petAId = petA.id

  const { data: clinicB } = await admin.from('clinics').insert({ name: 'RLS Audit Clinic B' }).select('id').single()
  clinicBId = clinicB.id

  const vetBId = await createUser(emails.vetB)
  const ownerId = await createUser(emails.owner)
  const ownerCId = await createUser(emails.ownerC)
  const adminId = await createUser(emails.admin)

  await admin.from('profiles').insert([
    { id: vetBId, role: 'vet', full_name: 'Audit Vet B', clinic_id: clinicBId },
    { id: ownerId, role: 'owner', full_name: 'Audit Owner', clinic_id: null },
    { id: ownerCId, role: 'owner', full_name: 'Audit Owner C', clinic_id: null },
    { id: adminId, role: 'admin', full_name: 'Audit Admin', clinic_id: null },
  ])

  const { data: petB } = await admin
    .from('pets')
    .insert({ clinic_id: clinicBId, owner_id: ownerId, name: 'AuditPetB', species: 'Dog', owner_name: 'Audit Owner' })
    .select('id')
    .single()
  petBId = petB.id

  const { data: caregiverB } = await admin
    .from('caregivers')
    .insert({ clinic_id: clinicBId, name: 'AuditStaffB', title: 'Vet Tech' })
    .select('id')
    .single()

  const { data: appointmentB } = await admin
    .from('appointments')
    .insert({ pet_id: petBId, clinic_id: clinicBId, scheduled_at: new Date(Date.now() + 86400000).toISOString(), created_by: vetBId })
    .select('id')
    .single()

  const { data: recordB } = await admin
    .from('medical_records')
    .insert({ pet_id: petBId, clinic_id: clinicBId, vet_id: vetBId, visit_type: 'checkup', diagnosis: 'x', treatment: 'y' })
    .select('id')
    .single()

  const { data: contactB } = await admin
    .from('pet_trusted_contacts')
    .insert({ pet_id: petBId, name: 'AuditContactB', phone: '5550000000' })
    .select('id')
    .single()

  const { data: paymentB } = await admin
    .from('payments')
    .insert({ pet_id: petBId, clinic_id: clinicBId, owner_id: ownerId, amount: 100, status: 'pending' })
    .select('id')
    .single()

  const { data: transferB } = await admin
    .from('ownership_transfers')
    .insert({ pet_id: petBId, from_owner_id: ownerId, to_owner_id: ownerCId, status: 'pending' })
    .select('id')
    .single()

  const vetBToken = await tokenFor(emails.vetB, password)
  const ownerToken = await tokenFor(emails.owner, password)
  const ownerCToken = await tokenFor(emails.ownerC, password)
  const adminToken = await tokenFor(emails.admin, password)

  const vetB = clientAs(vetBToken)
  const owner = clientAs(ownerToken)
  const ownerC = clientAs(ownerCToken)
  const adminUser = clientAs(adminToken)
  const anon = clientAs(anonKey)

  console.log('\nRunning cross-tenant probes...\n')

  // --- Clinic isolation: Clinic B vet vs Clinic A's data ---
  {
    const { data } = await vetB.from('pets').select('id').eq('id', petAId)
    check('vetB cannot read Clinic A pet by id', (data ?? []).length === 0)
  }
  {
    const { data } = await vetB.from('pets').update({ name: 'HACKED' }).eq('id', petAId).select()
    check('vetB cannot update Clinic A pet', (data ?? []).length === 0)
  }
  {
    const { data } = await vetB.from('pets').select('id, clinic_id')
    const leaked = (data ?? []).some((p) => p.clinic_id !== clinicBId)
    check('vetB pet list contains only Clinic B rows', !leaked)
  }
  {
    const { data } = await vetB.from('caregivers').select('id, clinic_id')
    const leaked = (data ?? []).some((c) => c.clinic_id !== clinicBId)
    check('vetB caregiver list contains only Clinic B rows', !leaked)
  }
  {
    const { data } = await vetB.from('appointments').select('id, clinic_id')
    const leaked = (data ?? []).some((a) => a.clinic_id !== clinicBId)
    check('vetB appointment list contains only Clinic B rows', !leaked)
  }
  {
    const { data } = await vetB.from('medical_records').select('id, clinic_id')
    const leaked = (data ?? []).some((r) => r.clinic_id !== clinicBId)
    check('vetB medical record list contains only Clinic B rows', !leaked)
  }
  {
    const { data } = await vetB.from('pet_trusted_contacts').select('id, pet_id')
    const leaked = (data ?? []).some((c) => c.pet_id !== petBId)
    check('vetB trusted contact list contains only Clinic B rows', !leaked)
  }
  {
    const { data } = await vetB.from('clinics').select('id')
    check('vetB sees only their own clinic', (data ?? []).length === 1 && data[0].id === clinicBId)
  }
  {
    const { data } = await vetB.from('clinics').update({ name: 'HACKED' }).eq('id', clinicAId).select()
    check('vetB cannot update Clinic A itself', (data ?? []).length === 0)
  }
  {
    const { data } = await vetB.from('payments').select('id, clinic_id')
    const leaked = (data ?? []).some((p) => p.clinic_id !== clinicBId)
    check('vetB payments list contains only Clinic B rows', !leaked)
  }

  // --- Owner role ---
  {
    const { data } = await owner.from('pets').select('id, owner_id')
    check('owner sees exactly their own pet', (data ?? []).length === 1 && data[0].owner_id === ownerId)
  }
  {
    const { data, error } = await owner.from('pets').update({ species: 'Cat' }).eq('id', petBId).select()
    check('owner blocked from changing restricted pet fields (trigger)', !!error && (data ?? []).length === 0, error?.message)
  }
  {
    const { data } = await owner.from('pets').update({ name: 'Renamed' }).eq('id', petBId).select()
    check('owner can rename their own pet (allowed field)', (data ?? []).length === 1)
    await admin.from('pets').update({ name: 'AuditPetB' }).eq('id', petBId)
  }
  {
    const { data } = await owner.from('medical_records').select('id').eq('pet_id', petBId)
    check("owner can view their pet's medical records", (data ?? []).length === 1)
  }
  {
    const { data } = await owner.from('payments').update({ status: 'paid' }).eq('id', paymentB.id).select()
    check('owner cannot update a payment (select-only policy)', (data ?? []).length === 0)
  }
  {
    const { data } = await owner.from('ownership_transfers').update({ status: 'accepted' }).eq('id', transferB.id).select()
    check('sending owner cannot accept their own transfer', (data ?? []).length === 0)
  }
  {
    const { data } = await ownerC.from('ownership_transfers').update({ status: 'accepted' }).eq('id', transferB.id).select()
    check('recipient owner can accept the transfer', (data ?? []).length === 1)
  }

  // --- Admin role: full cross-clinic access ---
  {
    const { data } = await adminUser.from('pets').select('id').in('id', [petAId, petBId])
    check('admin sees pets from both clinics', (data ?? []).length === 2)
  }
  {
    const { data } = await adminUser.from('clinics').select('id').in('id', [clinicAId, clinicBId])
    check('admin sees both clinics', (data ?? []).length === 2)
  }

  // --- Fully unauthenticated ---
  {
    const { data } = await anon.from('pets').select('id')
    check('unauthenticated request sees no pets', (data ?? []).length === 0)
  }
  {
    const { error } = await anon.from('pets').insert({ clinic_id: clinicBId, name: 'anon', species: 'Dog', owner_name: 'x' })
    check('unauthenticated insert is rejected', !!error)
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)
  if (failed.length) {
    console.log('\nFailed checks:')
    for (const f of failed) console.log(`  - ${f.label}${f.detail ? ` (${f.detail})` : ''}`)
  }

  await cleanup()
  process.exit(failed.length ? 1 : 0)
} catch (err) {
  console.error('\nAudit script errored:', err)
  await cleanup()
  process.exit(1)
}
