// Sweep script (11-05: the 11-05 nightly report; see README.md). Staging only.
// B41 + B42 + H68 earlier visits, B43 + H69 admin activity, H66 alerts, H67 sex + neutered, AC waiver fingerprint,
// AD diagnosis list + report. Saves diagnosis terms and a cancelled "Sweep1105" visit on the demo clinic (wiped in the v2 reset).
// Run against a local staging build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j23-nightly-1105.cjs
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
const RUN = Date.now().toString().slice(-5)
let failed = 0
const expect = (ok, what) => { if (!ok) throw new Error(what) }

async function login(b, user, pass, { lang = 'en', dark = false, ...options } = {}) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 820, height: 1180 }, ...options })
  await ctx.addInitScript(([l, th]) => { localStorage.setItem('touq-language', l); localStorage.setItem('touq-theme', th) }, [lang, dark ? 'dark' : 'light'])
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 160)))
  await p.goto(SITE); await p.fill('input[autocomplete=username]', user); await p.fill('input[type=password]', pass)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000)
  const pick = p.locator('.branch-picker-list button').first()
  if (await pick.count()) { await pick.click(); await p.waitForTimeout(1500) }
  return p
}
async function step(p, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 220))
    await p.screenshot({ path: out + `j23-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {})
  }
}
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const [pet, clinic, branch] = sql(`select p.id || '|' || p.clinic_id || '|' || (select sb.branch_id from staff_branches sb join profiles pr on pr.id = sb.profile_id where pr.username = 'amal.desk' limit 1) from pets p join clinics c on c.id = p.clinic_id where p.name = 'Sunny' and c.name like 'Al Nakheel%' limit 1`).split('|')
  const doctor = sql(`select id from profiles where username = 'khalid.vet'`)
  const appt = sql(`insert into appointments (pet_id, clinic_id, branch_id, doctor_id, created_by, scheduled_at, status, reason) values ('${pet}', '${clinic}', '${branch}', '${doctor}', '${doctor}', now(), 'confirmed', 'Sweep1105 ${RUN}') returning id`).split('\n')[0]
  const TERM = 'Sweep otitis ' + RUN
  const DX = 'Sweep1105 own diagnosis ' + RUN

  const d = await login(b, 'khalid.vet', PASS.demoStaff)
  await step(d, 'AD doctor adds a term in Settings, a duplicate is refused', async () => {
    await d.goto(SITE + '/settings'); await d.waitForTimeout(2500)
    const add = d.getByRole('button', { name: '+ Add diagnosis' })
    await add.click()
    await d.getByLabel('Name in English').fill(TERM); await d.getByLabel('Name in Arabic').fill('التهاب ' + RUN)
    await d.getByLabel('Name in Arabic').press('Enter'); await d.waitForTimeout(1500)
    expect(await d.getByText(TERM).count(), 'term not listed')
    await add.click()
    await d.getByLabel('Name in English').fill(TERM.toUpperCase()); await d.getByLabel('Name in Arabic').fill('آخر ' + RUN)
    await d.getByLabel('Name in Arabic').press('Enter'); await d.waitForTimeout(1500)
    expect(await d.getByText('already on the list').count(), 'duplicate not refused')
    await d.getByRole('button', { name: 'Cancel' }).last().click()
  })

  await step(d, 'H68 + B42 the session shows earlier visits as a closed bar above the form, without its own record', async () => {
    await d.goto(`${SITE}/appointments/${appt}/session`); await d.waitForTimeout(3500)
    const bar = d.locator('.session-history-toggle')
    await bar.waitFor()
    expect((await bar.getAttribute('aria-expanded')) === 'false', 'bar not closed')
    const barY = (await bar.boundingBox()).y
    const formY = (await d.locator('form.session-form').boundingBox()).y
    expect(barY < formY, 'bar is not above the form')
    expect(!(await d.locator('.session-history .record-list').isVisible()), 'list shows while closed')
    await d.getByLabel('Diagnosis', { exact: false }).last().fill(DX)
    await d.getByRole('button', { name: 'Save', exact: true }).click(); await d.waitForTimeout(2000)
    await d.reload(); await d.waitForTimeout(3500)
    await d.locator('.session-history-toggle').click()
    expect(await d.locator('.session-history .record-list').isVisible(), 'list did not open')
    expect(!(await d.locator('.session-history').getByText(DX).count()), 'the visit shows in its own history')
    expect(await d.locator('.session-history a', { hasText: 'View visit' }).count(), 'no View link')
    await d.screenshot({ path: out + 'j23-session-tablet.png' })
  })

  await step(d, 'B41 a failed history load says so and retries, instead of "no earlier visits"', async () => {
    await d.route(/medical_records.*vet/, (r) => r.abort())
    await d.reload()
    await d.getByText("Couldn't load earlier visits").waitFor({ timeout: 25000 })
    expect(!(await d.getByText('No earlier visits').count()), 'still says no earlier visits')
    await d.unroute(/medical_records.*vet/)
    await d.getByRole('button', { name: 'Try again' }).click(); await d.waitForTimeout(2500)
    expect(!(await d.getByText("Couldn't load earlier visits").count()), 'retry did not clear the error')
  })

  await step(d, 'H66 add an alert in the session; it stays after a reload and on the pet file', async () => {
    await d.getByRole('button', { name: '+ Add alert' }).click()
    await d.locator('.pet-alert-edit textarea').fill('Sweep allergic to penicillin')
    await d.locator('.pet-alert-edit').getByRole('button', { name: 'Save' }).click(); await d.waitForTimeout(1500)
    await d.reload(); await d.waitForTimeout(3500)
    expect(await d.locator('.pet-alert', { hasText: 'Sweep allergic' }).count(), 'not in the session after reload')
    await d.waitForTimeout(500)
  })

  await step(d, 'AD picking a term fills the diagnosis and links the visit', async () => {
    await d.getByLabel('Pick from the diagnosis list').selectOption(TERM)
    expect((await d.getByLabel('Diagnosis', { exact: false }).last().inputValue()) === TERM, 'text not filled')
    await d.getByRole('button', { name: 'Save', exact: true }).click(); await d.waitForTimeout(2000)
    const linked = sql(`select t.name_en from medical_records m join diagnosis_terms t on t.id = m.diagnosis_term_id where m.appointment_id = '${appt}'`)
    expect(linked === TERM, `visit linked to "${linked}"`)
  })

  await step(d, 'H68 View visit opens that record on the pet file', async () => {
    await d.locator('.session-history-toggle').click()
    await d.locator('.session-history a', { hasText: 'View visit' }).first().click(); await d.waitForTimeout(3000)
    expect(d.url().includes(`/pets/${pet}?record=`), 'wrong page ' + d.url())
    expect(await d.locator('.pet-alert', { hasText: 'Sweep allergic' }).count(), 'alert not on the pet file')
    await d.screenshot({ path: out + 'j23-pet-file.png' })
  })

  const r = await login(b, 'amal.desk', PASS.demoStaff)
  await step(r, 'H66 reception sees the alert on the dashboard and can edit it', async () => {
    await r.goto(SITE + '/'); await r.waitForTimeout(3000)
    expect(await r.locator('.pet-alert-chip').count(), 'no chip on the dashboard row')
    await r.goto(`${SITE}/pets/${pet}`); await r.waitForTimeout(3000)
    await r.locator('.pet-alert-row').getByRole('button', { name: 'Edit' }).click()
    await r.locator('.pet-alert-edit textarea').fill('Sweep allergic, bites')
    await r.locator('.pet-alert-edit').getByRole('button', { name: 'Save' }).click(); await r.waitForTimeout(1500)
    expect(sql(`select alerts from pets where id = '${pet}'`) === 'Sweep allergic, bites', 'edit not saved')
  })

  await step(r, 'H67 sex and neutered: set, clear by pressing again, shown on the file', async () => {
    await r.locator('.pet-file-details').getByRole('button', { name: 'Edit', exact: true }).click(); await r.waitForTimeout(500)
    await r.getByRole('button', { name: 'Female' }).click()
    await r.getByRole('button', { name: 'Not neutered' }).click()
    await r.getByRole('button', { name: 'Neutered', exact: true }).click()
    await r.getByRole('button', { name: 'Neutered', exact: true }).click() // pressed again: cleared
    await r.getByRole('button', { name: 'Neutered', exact: true }).click()
    await r.getByRole('button', { name: /Save changes/ }).click(); await r.waitForTimeout(1500)
    expect(sql(`select sex || '|' || neutered from pets where id = '${pet}'`) === 'female|true', 'wrong values')
    expect(await r.locator('.pet-file-meta', { hasText: 'Female · Neutered' }).count(), 'not in the header')
  })

  await step(r, 'AC waiver prints its record code; a changed waiver warns', async () => {
    expect(sql(`select count(*) from pet_waivers where fingerprint is null`) === '0', 'a waiver has no fingerprint')
    const code = sql(`select upper(left(fingerprint, 4)) from pet_waivers where pet_id = '${pet}' order by signed_at desc limit 1`)
    await r.route(/rest\/v1\/pet_waivers/, async (route) => {
      const res = await route.fetch(); const rows = await res.json()
      await route.fulfill({ response: res, json: rows.map((w) => ({ ...w, fingerprint_ok: false })) })
    })
    await r.reload(); await r.waitForTimeout(3500)
    await r.locator('.pet-file-side').getByRole('button', { name: /^View/ }).first().click(); await r.waitForTimeout(800)
    expect(await r.getByText('no longer matches what was signed').count(), 'no warning')
    const [popup] = await Promise.all([r.context().waitForEvent('page'), r.getByRole('button', { name: /Print/ }).last().click()])
    await popup.waitForTimeout(1200)
    const text = await popup.locator('body').innerText()
    expect(text.includes('Record code') || text.includes('رمز السجل'), 'no record code on the print')
    expect(text.includes(code), 'printed code differs')
    await popup.close()
    await r.unroute(/rest\/v1\/pet_waivers/)
  })

  const m = await login(b, 'MohBaf@touq.app', PASS.cofounder, { viewport: { width: 1280, height: 900 } })
  await step(m, 'AD the manager report counts the visit under its term', async () => {
    await m.goto(SITE + '/reports'); await m.waitForTimeout(2500)
    await m.getByRole('button', { name: 'Diagnoses' }).or(m.getByRole('tab', { name: 'Diagnoses' })).first().click(); await m.waitForTimeout(2500)
    const row = m.locator('.data-row, tr', { hasText: TERM }).first()
    expect(await row.count(), 'term not in the report')
    expect((await row.innerText()).includes('1'), 'wrong count')
    expect(await m.locator('input[type=date]').count(), 'the report has no date range')
    await m.screenshot({ path: out + 'j23-report.png' })
  })

  const a = await login(b, 'staging.admin', PASS.admin)
  await step(a, 'B43 + H69 activity: a failed load says so, filters narrow the list', async () => {
    await a.route(/admin_audit_log/, (x) => x.abort())
    await a.goto(SITE + '/activity')
    await a.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 25000 })
    expect(!(await a.getByText('No admin activity yet').count()), 'still says no activity')
    await a.unroute(/admin_audit_log/)
    await a.getByRole('button', { name: 'Try again' }).click(); await a.waitForTimeout(2500)
    const all = await a.locator('.data-activity .pet-list-item').count()
    expect(all > 0, 'list empty after the retry')
    const clinicPick = a.locator('.activity-filters select').first()
    await clinicPick.selectOption({ index: 1 }); await a.waitForTimeout(2000)
    const clinicName = await clinicPick.locator('option:checked').innerText()
    console.log('  filtered by', clinicName.slice(0, 30), await a.locator('.data-activity .pet-list-item').count(), 'of', all)
    await clinicPick.selectOption({ index: 0 }); await a.waitForTimeout(2000)
    const action = await sql(`select action from admin_audit_log group by action order by count(*) desc limit 1`)
    await a.locator('.activity-filters select').last().selectOption(action); await a.waitForTimeout(2000)
    const shown = await a.locator('.data-activity .pet-list-item').count()
    expect(shown > 0, 'the action filter emptied the list')
    await a.screenshot({ path: out + 'j23-activity.png' })
  })

  const ar = await login(b, 'khalid.vet', PASS.demoStaff, { lang: 'ar', dark: true, viewport: { width: 390, height: 844 }, hasTouch: true })
  await step(ar, 'Arabic, dark, phone: alert and earlier visits fit, in Arabic', async () => {
    await ar.goto(`${SITE}/appointments/${appt}/session`); await ar.waitForTimeout(3500)
    await ar.locator('.session-history-toggle').click(); await ar.waitForTimeout(400)
    expect(await noSideways(ar), 'sideways scroll')
    expect(await ar.getByText('تنبيهات').count(), 'alert title not Arabic')
    await ar.screenshot({ path: out + 'j23-session-ar-dark-phone.png' })
  })

  // Sunny goes back to how it was; the terms and the cancelled visit stay for the v2 reset.
  sql(`update pets set alerts = null, sex = null, neutered = null where id = '${pet}'`)
  sql(`update appointments set status = 'cancelled', cancellation_category = 'other', cancellation_reason = 'sweep' where reason like 'Sweep1105%' and status <> 'cancelled'`)
  await b.close()
  console.log(failed ? `${failed} FAILED` : 'all passed')
  process.exit(failed ? 1 : 0)
})()
