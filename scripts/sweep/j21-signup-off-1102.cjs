// Sweep script (11-02; see README.md). Staging only, by API, cleans up after itself.
// With public sign-ups off: a sign-up is refused, yet the admin still creates a clinic + manager, the manager still
// adds staff, and both log in. The throwaway clinic is then trashed and purged.
const fs = require('fs')
const { PASS, SPSQL } = require('./config.cjs')
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
const env = Object.fromEntries(fs.readFileSync('.env.staging.local', 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL = 'https://epsnbhxlpxlcqwtzbofq.supabase.co'
const KEY = env.VITE_SUPABASE_ANON_KEY
const RUN = Date.now().toString().slice(-5)
const NAME = 'Sweep Signup ' + RUN
const expect = (c, m) => { if (!c) throw new Error(m) }
const json = { apikey: KEY, 'content-type': 'application/json' }
async function signIn(email, password) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) })
  return (await res.json()).access_token
}
async function fn(name, token, body) {
  const res = await fetch(`${URL}/functions/v1/${name}`, { method: 'POST', headers: { ...json, authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => null) }
}
;(async () => {
  let admin, clinic
  try {
    const settings = await (await fetch(`${URL}/auth/v1/settings`, { headers: { apikey: KEY } })).json()
    expect(settings.disable_signup === true, 'sign-ups are still on: not trying one')
    const refused = await (await fetch(`${URL}/auth/v1/signup`, { method: 'POST', headers: json, body: JSON.stringify({ email: `stranger${RUN}@staff.touq.invalid`, password: 'SweepStranger' + RUN }) })).json()
    expect(refused.error_code === 'signup_disabled', 'sign-up reply: ' + JSON.stringify(refused).slice(0, 160))
    console.log('ok a public sign-up is refused:', refused.error_code)

    admin = await signIn('staging.admin@staff.touq.invalid', PASS.admin)
    expect(admin, 'admin sign-in failed')
    const pass = 'SweepClinic' + RUN
    let r = await fn('admin-manage-clinic', admin, { action: 'create', clinicName: NAME, vetFullName: 'Sweep Manager', vetUsername: 'sweep.mgr' + RUN, vetPassword: pass, vetPhone: null })
    clinic = sql(`select id from clinics where name = '${NAME}'`)
    expect(clinic, `admin could not create a clinic: ${r.status} ${JSON.stringify(r.body)}`)
    const manager = await signIn(`sweep.mgr${RUN}@staff.touq.invalid`, pass)
    expect(manager, 'the new manager cannot log in')
    console.log('ok admin creates a clinic + manager, who logs in')

    const branch = sql(`select id from branches where clinic_id = '${clinic}' and is_main`)
    r = await fn('clinic-manage-staff', manager, { action: 'create_staff', username: 'sweep.staff' + RUN, password: pass, fullName: 'Sweep Staff', clinicRole: 'nurse', branchIds: [branch] })
    expect(r.status === 200 && !r.body?.error, `manager could not add staff: ${r.status} ${JSON.stringify(r.body)}`)
    expect(await signIn(`sweep.staff${RUN}@staff.touq.invalid`, pass), 'the new staff member cannot log in')
    console.log('ok manager adds a staff member, who logs in')
  } catch (e) {
    console.log('FAIL', e.message)
    process.exitCode = 1
  }
  if (admin && clinic) {
    await fn('admin-manage-clinic', admin, { action: 'trash', clinicId: clinic })
    const r = await fn('admin-manage-clinic', admin, { action: 'purge', clinicId: clinic })
    const left = sql(`select (select count(*) from clinics where id = '${clinic}') + (select count(*) from auth.users where email like 'sweep.%${RUN}@staff.touq.invalid')`)
    console.log(left === '0' ? 'ok throwaway clinic and its 2 accounts removed' : `LEFTOVER ${left} rows after purge (${r.status}) for clinic ${clinic}`)
    if (left !== '0') process.exitCode = 1
  }
})()
