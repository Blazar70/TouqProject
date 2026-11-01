// One-off check of the 11-01 purge fixes on staging (B33 refuse live clinic, B34 batched expired pets).
const fs = require('fs')
const { PASS, SPSQL } = require('./config.cjs')
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
const env = Object.fromEntries(fs.readFileSync('.env.staging.local', 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL = env.VITE_SUPABASE_URL || 'https://epsnbhxlpxlcqwtzbofq.supabase.co'
if (!URL.includes('epsnbhxlpxlcqwtzbofq')) throw new Error('not staging')
const KEY = env.VITE_SUPABASE_ANON_KEY
const expect = (c, m) => { if (!c) throw new Error(m) }
;(async () => {
  const auth = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'staging.admin@staff.touq.invalid', password: PASS.admin }) })).json()
  expect(auth.access_token, 'admin sign-in failed')
  const call = async (body, extra = {}) => {
    const res = await fetch(`${URL}/functions/v1/admin-manage-clinic`, { method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${auth.access_token}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  const RUN = Date.now().toString().slice(-5)
  const clinic = sql(`insert into clinics (name) values ('Sweep B33 ${RUN}') returning id`).split('\n')[0]
  try {
    let r = await call({ action: 'purge', clinicId: clinic })
    expect(r.status === 409 && sql(`select count(*) from clinics where id = '${clinic}'`) === '1', `live clinic purge: ${r.status} ${JSON.stringify(r.json)}`)
    console.log('ok B33: purge of a live clinic refused (409):', r.json.error)

    sql(`insert into pets (clinic_id, name, species, owner_name, owner_phone, deleted_at) select '${clinic}', 'Sweep B34 ' || g, 'cat', 'Sweep B34 Owner', '+96655${RUN}' || lpad(g::text, 2, '0'), now() - interval '40 days' from generate_series(1, 120) g`)
    expect(sql(`select count(*) from pets where clinic_id = '${clinic}'`) === '120', 'test pets not created')
    const secret = sql(`select decrypted_secret from vault.decrypted_secrets where name = 'cron_purge_secret'`)
    const res = await fetch(`${URL}/functions/v1/admin-manage-clinic`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json', 'x-cron-secret': secret }, body: JSON.stringify({ action: 'purge_expired' }) })
    const json = await res.json()
    const left = sql(`select count(*) from pets where clinic_id = '${clinic}'`)
    expect(res.status === 200 && left === '0' && json.petsPurged >= 120 && json.petErrors.length === 0, `expired purge: ${res.status} left=${left} ${JSON.stringify(json).slice(0, 300)}`)
    console.log(`ok B34: 120 expired pets purged in batches (petsPurged ${json.petsPurged}, storage failures ${json.petStorageFailures}, errors ${json.petErrors.length})`)

    sql(`update clinics set deleted_at = now(), disabled = true where id = '${clinic}'`)
    r = await call({ action: 'purge', clinicId: clinic })
    expect(r.status === 200 && sql(`select count(*) from clinics where id = '${clinic}'`) === '0', `trashed clinic purge: ${r.status} ${JSON.stringify(r.json)}`)
    console.log('ok trashed clinic still purges (200)')
  } catch (e) {
    console.log('FAIL', e.message)
    process.exitCode = 1
  }
})()
