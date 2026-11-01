// Sweep script (11-01: the handoff's untested list, everything that needs no real device; see README.md). Staging only.
// Saves data on the demo clinic (reset after v2); the calendar order is put back.
// Shared session: nurse applies a template + adds a photo, doctor finishes with a prescription -> visit summary print
// (EN + Arabic dates) and report print in Arabic -> nurse stops, then cancels, a session -> an arrived visit moved to
// another day is Confirmed again -> time-off preview counts it -> other-branch record has no Edit -> branch manager
// reorders calendar columns -> purging a pet removes its inpatient photos -> waiver text edit, nurse collects a waiver
// linked to today's visit -> manager's reminder carries the clinic phone -> lock across two tabs -> pasted phone ->
// Arabic device starts in Arabic -> week-view tap-to-book from a Tokyo device -> quick search in Arabic dark on a phone
// -> dashboard, Payments and the database agree on today's money -> screenshots for the user's eye.
// Run against a local build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j15-untested-1101.cjs [stepPrefix ...]
const fs = require('fs')
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const PET = '30359b93-8e11-481b-988c-e84be20ff062' // Sunny, Waleed Al-Asiri (Al Nakheel)
const CLINIC = 'Al Nakheel Veterinary Clinic'
const RUN = Date.now().toString().slice(-5)
const TEMPLATE = 'Sweep nurse template ' + RUN
const only = process.argv.slice(2)
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
const PNG = out + 'j15-dot.png'
fs.writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
let failed = 0

async function login(browser, user, pass, { w = 1180, h = 820, lang = 'en', theme = 'light', tz = 'Asia/Riyadh', branch = 'Al Olaya', locale } = {}) {
  const ctx = await browser.newContext({ timezoneId: tz, viewport: { width: w, height: h }, hasTouch: w < 1000, locale })
  await ctx.addInitScript(([l, th]) => { if (l) localStorage.setItem('touq-language', l); localStorage.setItem('touq-theme', th) }, [lang, theme])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  await page.goto(SITE)
  await page.fill('input[autocomplete=username]', user)
  await page.fill('input[type=password]', pass)
  await page.click('form.login-form button[type=submit]')
  await page.waitForTimeout(4000)
  page.pick = async () => {
    // Multi-branch staff get the picker again after navigating; in Arabic the branch names may differ, so else the first.
    const list = page.locator('.branch-picker-list button')
    if (!(await list.count())) return
    const named = list.filter({ hasText: branch }).first()
    await ((await named.count()) ? named : list.first()).click(); await page.waitForTimeout(1500)
  }
  await page.pick()
  page.go = async (path) => {
    await page.evaluate((url) => { history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate')) }, path)
    await page.waitForTimeout(3000)
  }
  return page
}
async function step(page, name, fn) {
  if (only.length && !only.some((p) => name.startsWith(p))) return
  try { const note = await fn(); console.log('ok', name + (note ? ' — ' + note : '')) } catch (e) {
    failed++
    console.log('FAIL', name, '-', process.env.J15_LONG ? e.message.slice(0, 1500) : e.message.split('\n')[0].slice(0, 220))
    await page.screenshot({ path: out + `j15-fail-${name.replace(/\W+/g, '-').slice(0, 60)}.png`, fullPage: true }).catch(() => {})
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg) }
async function printed(page, click) {
  await page.context().addInitScript(() => { window.print = () => {} })
  await page.evaluate(() => { window.print = () => {} })
  await page.bringToFront() // a print window only opens from the tab in front
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null), click()])
  if (!popup) throw new Error(`no print window; toasts: ${JSON.stringify(await page.locator('[role=status], [role=alert]').allInnerTexts())}; errors: ${errors.join(' | ').slice(0, 200)}; buttons: ${await page.getByRole('button', { name: /Print summary|طباعة الملخص/ }).count()}`)
  await popup.waitForLoadState()
  const html = (await popup.content()).split('<body')[1] ?? ''
  await popup.close()
  return html
}
async function confirmDialog(page) {
  const c = page.getByRole('alertdialog')
  // The confirm button comes first, Cancel last.
  if (await c.count()) { await c.locator('button:not(.cancel-button)').first().click(); await page.waitForTimeout(1500) }
}
// Reception books Sunny with Khalid today at hh:mm PM and marks it Arrived; returns the appointment id.
async function bookArrived(r, reason, hour, minute) {
  await r.goto(SITE + '/appointments?pet=' + PET)
  await r.waitForSelector('[role=dialog] input[type=date]', { timeout: 8000 })
  const dlg = r.locator('[role=dialog]')
  await dlg.locator('input[type=date]').fill(day())
  await dlg.getByLabel('Hour').selectOption(hour)
  await dlg.getByLabel('Minute').selectOption(minute)
  await dlg.locator('select').nth(2).selectOption('PM')
  await dlg.getByLabel('Reason').fill(reason)
  const doc = dlg.locator('select').last()
  await doc.selectOption(await doc.locator('option', { hasText: 'Khalid' }).first().getAttribute('value'))
  await dlg.locator('button[type=submit]').first().click(); await r.waitForTimeout(2500); await r.pick()
  const anyway = dlg.getByRole('button', { name: /Schedule anyway/ })
  if (await anyway.count()) { await anyway.click(); await r.waitForTimeout(2500) }
  const ack = dlg.getByRole('checkbox')
  if (await ack.count()) { await ack.first().check(); await dlg.locator('button[type=submit]').first().click(); await r.waitForTimeout(2500) }
  const id = sql(`select id from appointments where reason = '${reason}' order by created_at desc limit 1`)
  expect(id, 'appointment not saved: ' + reason)
  await r.goto(SITE + '/appointments?open=' + id); await r.waitForTimeout(3000); await r.pick()
  const confirm = r.getByRole('button', { name: /^Confirm$/ })
  if (await confirm.count()) { await confirm.first().click(); await r.waitForTimeout(1500); await r.goto(SITE + '/appointments?open=' + id); await r.waitForTimeout(3000); await r.pick() }
  await r.getByRole('button', { name: /^Arrived$/ }).first().click(); await r.waitForTimeout(2000)
  return id
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const clinicId = sql(`select id from clinics where name = '${CLINIC}'`)
  const r = await login(browser, 'amal.desk', PASS.demoStaff)
  const d = await login(browser, 'khalid.vet', PASS.demoStaff)
  const n = await login(browser, 'huda.nurse', PASS.demoStaff)

  // ---- shared session: nurse template + photo, doctor prescription
  let SHARED = null
  await step(n, 'session: nurse applies a template and adds a photo in the doctor\'s session', async () => {
    sql(`insert into visit_templates (clinic_id, name, fields, prescription) values ('${clinicId}', '${TEMPLATE}', '{"physicalExam": "Sweep: ears red, no fever", "diagnosis": "Sweep doctor-only text"}', '[]')`)
    SHARED = await bookArrived(r, 'Sweep 1101 shared ' + RUN, '9', '15')
    await d.goto(SITE + '/appointments?open=' + SHARED); await d.waitForTimeout(3000); await d.pick()
    await d.getByRole('button', { name: /Start session/ }).first().click()
    await d.waitForURL(/\/session/, { timeout: 8000 }); await d.waitForTimeout(2500)
    await d.getByLabel(/Presenting complaint/i).fill('Sweep: shaking head')
    await d.getByRole('button', { name: /^Save$/ }).click(); await d.waitForTimeout(2500)
    await n.goto(SITE + '/appointments?open=' + SHARED); await n.waitForTimeout(3000); await n.pick()
    await n.getByRole('button', { name: /Resume session/ }).first().click()
    await n.waitForURL(/\/session/, { timeout: 8000 }); await n.waitForTimeout(3000)
    await n.getByLabel('Use a template').selectOption({ label: TEMPLATE }); await n.waitForTimeout(800)
    await confirmDialog(n)
    expect((await n.getByLabel(/Symptoms \/ physical exam/).inputValue()) === 'Sweep: ears red, no fever', 'nurse template did not fill the exam')
    expect((await n.getByLabel(/^Diagnosis/).count()) === 0, 'nurse sees the diagnosis field')
    await n.locator('input[type=file]').setInputFiles(PNG); await n.waitForTimeout(800)
    await n.getByRole('button', { name: /^Save$/ }).click(); await n.waitForTimeout(4000)
    const row = sql(`select physical_exam || '|' || coalesce(diagnosis, '') || '|' || (photo_url is not null) || '|' || presenting_complaint from medical_records where appointment_id = '${SHARED}'`)
    expect(row === 'Sweep: ears red, no fever||true|Sweep: shaking head', 'record after the nurse saved: ' + row)
  })
  await step(d, 'session: doctor sees the nurse\'s part and finishes with a prescription', async () => {
    expect(SHARED, 'no shared session')
    await d.reload(); await d.waitForTimeout(3500)
    expect((await d.getByLabel(/Symptoms \/ physical exam/).inputValue()) === 'Sweep: ears red, no fever', 'doctor does not see the nurse\'s exam')
    await d.locator('form.session-form select').first().selectOption({ index: 1 })
    await d.getByLabel(/^Diagnosis/).fill('Sweep otitis')
    await d.getByLabel(/^Treatment/).fill('Ear cleaning')
    await d.getByRole('button', { name: /Add medicine/ }).click()
    await d.getByLabel('Medicine').fill('Sweep drops')
    await d.getByLabel('Dose').fill('2 drops')
    await d.getByLabel('How often').fill('twice a day')
    await d.getByLabel('For how long').fill('5 days')
    await d.getByRole('button', { name: /Finish session/ }).first().click(); await d.waitForTimeout(1500)
    await confirmDialog(d); await d.waitForTimeout(2500)
    expect(sql(`select status from appointments where id = '${SHARED}'`) === 'completed', 'not completed')
    expect(sql(`select prescription->0->>'medicine' from medical_records where appointment_id = '${SHARED}'`) === 'Sweep drops', 'prescription not saved')
  })
  await step(d, 'prints: visit summary with the prescription, English then Arabic dates', async () => {
    expect(SHARED, 'no shared session')
    await d.goto(SITE + '/'); await d.waitForTimeout(3000); await d.pick()
    await d.go('/appointments?open=' + SHARED)
    let html = await printed(d, () => d.locator('[role=dialog]').getByRole('button', { name: 'Print summary' }).click())
    expect(html.includes('Sweep drops') && html.includes('twice a day'), 'summary print has no prescription')
    // The login helper sets the language on every load, so Arabic needs its own sign-in.
    const dar = await login(browser, 'khalid.vet', PASS.demoStaff, { lang: 'ar' })
    await dar.go('/appointments?open=' + SHARED)
    html = await printed(dar, () => dar.locator('[role=dialog]').getByRole('button', { name: 'طباعة الملخص' }).click())
    const month = new Date().toLocaleDateString('ar', { month: 'long', timeZone: 'Asia/Riyadh' })
    expect(html.includes(month) && html.includes('Sweep drops'), `Arabic summary print has no "${month}" date or no prescription`)
    fs.writeFileSync(out + 'j15-summary-ar.html', '<body' + html)
    await dar.context().close()
  })
  const mar = await login(browser, 'MohBaf@touq.app', PASS.cofounder, { lang: 'ar' })
  await step(mar, 'prints: report print in Arabic', async () => {
    const m = mar
    await m.goto(SITE + '/reports'); await m.waitForTimeout(4000); await m.pick()
    const button = m.getByRole('button', { name: /^طباعة$/ }).first()
    await m.waitForFunction((el) => !el.disabled, await button.elementHandle(), { timeout: 15000 })
    const html = await printed(m, () => button.click())
    const digitsOk = !/[٠-٩]/.test(html)
    fs.writeFileSync(out + 'j15-report-ar.html', '<body' + html)
    await m.context().close()
    expect(/[؀-ۿ]{3,}/.test(html), 'report print not in Arabic')
    return `printed (${digitsOk ? 'Latin digits' : 'Arabic digits'}); saved j15-report-ar.html for the eye`
  })

  // ---- nurse stops and cancels; reschedule reset; time off preview
  await step(n, 'nurse: Stop session, then Cancel appointment', async () => {
    const id = await bookArrived(r, 'Sweep 1101 stop ' + RUN, '9', '30')
    await n.goto(SITE + '/appointments?open=' + id); await n.waitForTimeout(3000); await n.pick()
    await n.getByRole('button', { name: /Start session/ }).first().click()
    await n.waitForURL(/\/session/, { timeout: 8000 }); await n.waitForTimeout(2500)
    expect(sql(`select status from appointments where id = '${id}'`) === 'in_session', 'nurse did not start the session')
    await n.goto(SITE + '/appointments?open=' + id); await n.waitForTimeout(3000); await n.pick()
    await n.getByRole('button', { name: /^Stop session$/ }).click(); await n.waitForTimeout(800)
    await confirmDialog(n); await n.waitForTimeout(1500)
    expect(sql(`select status || '|' || (started_at is null) from appointments where id = '${id}'`) === 'confirmed|true', 'stop did not go back to Confirmed: ' + sql(`select status from appointments where id = '${id}'`))
    await n.goto(SITE + '/appointments?open=' + id); await n.waitForTimeout(3000); await n.pick()
    await n.getByRole('button', { name: /^Cancel appointment$/ }).click(); await n.waitForTimeout(800)
    await n.getByLabel(/Why is this being cancelled/).selectOption({ index: 1 })
    const details = n.getByLabel(/Details/) // only shown for the "Other" reason
    if (await details.count()) await details.fill('Sweep nurse cancel')
    await n.getByRole('button', { name: /Confirm cancellation/ }).click(); await n.waitForTimeout(2500)
    expect(sql(`select status from appointments where id = '${id}'`) === 'cancelled', 'nurse cancel not saved')
  })
  let MOVED = null
  await step(r, 'reschedule: an arrived visit moved to tomorrow is Confirmed again', async () => {
    MOVED = await bookArrived(r, 'Sweep 1101 move ' + RUN, '9', '45')
    expect(sql(`select status from appointments where id = '${MOVED}'`) === 'arrived', 'not arrived')
    await r.goto(SITE + '/appointments?open=' + MOVED); await r.waitForTimeout(3000); await r.pick()
    await r.getByRole('button', { name: /^Reschedule$/ }).click(); await r.waitForTimeout(800)
    const panel = r.locator('[role=dialog]').last()
    await panel.locator('input[type=date]').fill(day(1))
    const selects = panel.locator('select')
    await selects.nth(0).selectOption('10')
    await selects.nth(1).selectOption('00')
    await selects.nth(2).selectOption('AM')
    await r.getByRole('button', { name: /Confirm new time/ }).click(); await r.waitForTimeout(2500)
    const anyway = r.getByRole('button', { name: /Schedule anyway|Reschedule anyway/ })
    if (await anyway.count()) { await anyway.first().click(); await r.waitForTimeout(2500) }
    const row = sql(`select status || '|' || to_char(scheduled_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') from appointments where id = '${MOVED}'`)
    expect(row === `confirmed|${day(1)} 10:00`, 'after reschedule: ' + row)
  })
  await step(r, 'time off: the preview counts the doctor\'s booked visit (not saved)', async () => {
    expect(MOVED, 'no moved appointment')
    const m = await login(browser, 'MohBaf@touq.app', PASS.cofounder)
    await m.goto(SITE + '/staff'); await m.waitForTimeout(3500); await m.pick()
    const row = m.locator('li', { hasText: 'Khalid' }).filter({ has: m.getByRole('button', { name: /^Time off$/ }) }).first()
    await row.getByRole('button', { name: /^Time off$/ }).click(); await m.waitForTimeout(1500)
    const form = m.locator('form', { has: m.getByText('Add time off') }).last()
    await form.getByLabel(/^Reason/).fill('Sweep preview')
    const dates = form.locator('input[type=date]'), times = form.locator('input[type=time]')
    await dates.nth(0).fill(day(1)); await times.nth(0).fill('09:00')
    await dates.nth(1).fill(day(1)); await times.nth(1).fill('11:00')
    await m.waitForTimeout(2000)
    const text = await form.innerText()
    await m.context().close()
    expect(/Saving moves \d+ appointments? to Unassigned/.test(text), 'no preview line: ' + text.slice(0, 200))
    expect(sql(`select count(*) from doctor_time_off where reason = 'Sweep preview'`) === '0', 'time off was saved')
    return text.match(/Saving moves[^.]*/)[0]
  })

  await step(n, 'other-branch record: no Edit for an Olaya-only doctor', async () => {
    const [pet, rec] = sql(`select m.pet_id || '|' || m.id from medical_records m join branches b on b.id = m.branch_id where m.clinic_id = '${clinicId}' and b.name = 'Al Malqa' limit 1`).split('|')
    expect(pet, 'no Al Malqa record on the demo clinic')
    const noura = await login(browser, 'noura.vet', PASS.demoStaff)
    await noura.goto(SITE + '/pets/' + pet); await noura.waitForTimeout(3500); await noura.pick()
    const item = noura.locator('li, .record-accordion-item').filter({ hasText: 'Seen at Al Malqa' }).first()
    expect(await item.count(), 'the Al Malqa record is not marked "Seen at Al Malqa"')
    const header = item.locator('.record-accordion-header, button').first()
    await header.click().catch(() => {}); await noura.waitForTimeout(800)
    const edits = await item.getByRole('button', { name: /^Edit$/ }).count()
    const olaya = noura.locator('li, .record-accordion-item').filter({ hasNotText: 'Seen at' }).filter({ has: noura.getByRole('button', { name: /^Edit$/ }) })
    await noura.context().close()
    expect(edits === 0, 'Edit shown on the other branch\'s record ' + rec)
  })

  await step(r, 'calendar order: branch manager has none; whole-clinic manager reorders (then back)', async () => {
    const e = await login(browser, 'east.mgr', PASS.eastMgr, { branch: 'East' })
    await e.goto(SITE + '/staff'); await e.waitForTimeout(3500); await e.pick()
    const branchManagerSees = await e.locator('.staff-calendar-order').count()
    await e.context().close()
    expect(branchManagerSees === 0, 'branch manager still sees the clinic-wide calendar order')
    const m = await login(browser, 'MohBaf@touq.app', PASS.cofounder)
    const order = () => sql(`select string_agg(full_name, ' > ' order by calendar_order nulls last, full_name) from profiles where clinic_id = '${clinicId}' and takes_appointments and not disabled`)
    const before = order()
    await m.goto(SITE + '/staff'); await m.waitForTimeout(3500); await m.pick()
    const section = m.locator('.staff-calendar-order')
    const first = (await section.locator('li strong').first().innerText()).trim()
    await section.getByRole('button', { name: `Move ${first} down` }).click(); await m.waitForTimeout(4000)
    const moved = order()
    await section.getByRole('button', { name: `Move ${first} up` }).click(); await m.waitForTimeout(4000)
    const back = order()
    await m.context().close()
    expect(moved !== before && moved.split(' > ')[1] === first, `move down: ${before} -> ${moved}`)
    expect(back.split(' > ')[0] === first, `move back: ${back}`)
    return moved
  })

  await step(d, 'pet purge removes its inpatient photos', async () => {
    const name = 'Sweep Purge ' + RUN
    const petId = sql(`insert into pets (clinic_id, name, species, owner_name, owner_phone) values ('${clinicId}', '${name}', 'cat', 'Sweep Purge Owner', '+96655${RUN}11') returning id`).split('\n')[0]
    await d.goto(SITE + '/pets/' + petId); await d.waitForTimeout(3500); await d.pick()
    await d.getByRole('button', { name: /^Admit$/ }).click(); await d.waitForTimeout(800)
    await d.getByRole('button', { name: /^Admit at/ }).click(); await d.waitForTimeout(3000)
    await d.getByLabel(/^Update$/).fill('Sweep photo update')
    await d.getByLabel(/Photos or videos/).setInputFiles(PNG); await d.waitForTimeout(800)
    await d.getByRole('button', { name: /^Add update at/ }).click(); await d.waitForTimeout(5000)
    const media = sql(`select string_agg(m, ',') from inpatient_updates u join inpatient_stays s on s.id = u.stay_id, unnest(u.media) m where s.pet_id = '${petId}'`)
    expect(media, 'update photo not saved')
    const inBucket = () => sql(`select count(*) from storage.objects where bucket_id = 'inpatient-media' and name = any(string_to_array('${media}', ','))`)
    expect(inBucket() === '1', 'photo not in the bucket')
    const m = await login(browser, 'MohBaf@touq.app', PASS.cofounder)
    try {
    await m.goto(SITE + '/pets/' + petId); await m.waitForTimeout(3500); await m.pick()
    await m.locator('section', { has: m.getByRole('heading', { name: 'Pet details' }) }).getByRole('button', { name: /^Edit$/ }).click()
    await m.getByRole('button', { name: /^Delete pet$/ }).click(); await m.waitForTimeout(800)
    await confirmDialog(m); await m.waitForTimeout(2000)
    await m.goto(SITE + '/pets'); await m.waitForTimeout(3000); await m.pick()
    await m.getByRole('button', { name: /Deleted pets/ }).first().click(); await m.waitForTimeout(1500)
    await m.locator('li', { hasText: name }).getByRole('button', { name: /Delete permanently/ }).click(); await m.waitForTimeout(800)
    const c = m.getByRole('alertdialog')
    expect((await c.innerText()).includes(name), 'purge confirm does not name the pet')
    await confirmDialog(m); await m.waitForTimeout(5000)
    var toast = await m.locator('body').innerText()
    } catch (e) { await m.screenshot({ path: out + 'j15-fail-purge-manager.png', fullPage: true }); throw e } finally { await m.context().close() }
    expect(sql(`select count(*) from pets where id = '${petId}'`) === '0', 'pet not purged')
    expect(inBucket() === '0', 'inpatient photo left in the bucket')
    expect(!toast.includes('could not be removed'), 'purge reported photos left')
  })

  await step(n, 'waivers: manager edits a text; nurse collects one linked to today\'s visit', async () => {
    const m = await login(browser, 'MohBaf@touq.app', PASS.cofounder)
    await m.goto(SITE + '/settings'); await m.waitForTimeout(3500); await m.pick()
    const tpl = m.locator('li', { hasText: 'Sweep template' }).first()
    await tpl.getByRole('button', { name: /^Edit$/ }).click(); await m.waitForTimeout(800)
    await m.getByLabel('Title (English)').fill('Sweep template ' + RUN)
    await m.locator('form', { has: m.getByLabel('Title (English)') }).getByRole('button', { name: /^Save$/ }).click(); await m.waitForTimeout(2500)
    await m.context().close()
    expect(sql(`select count(*) from waiver_templates where title_en = 'Sweep template ${RUN}'`) === '1', 'waiver text edit not saved')
    sql(`update waiver_templates set title_en = 'Sweep template' where title_en = 'Sweep template ${RUN}'`)

    const before = +sql(`select count(*) from pet_waivers where pet_id = '${PET}'`)
    await n.goto(SITE + '/pets/' + PET); await n.waitForTimeout(3500); await n.pick()
    await n.getByRole('button', { name: /^Collect a signature$/ }).first().click(); await n.waitForTimeout(1200)
    const dlg = n.locator('[role=dialog]').last()
    await dlg.getByLabel(/^Waiver/).selectOption({ index: 1 }).catch(() => {})
    const link = dlg.getByLabel('Link to')
    const visit = (await link.locator('option').allInnerTexts()).find((o) => o.startsWith('Today’s visit'))
    expect(visit, 'no "Today’s visit" option to link')
    await link.selectOption({ label: visit })
    await dlg.getByRole('button', { name: /Owner view/ }).click(); await n.waitForTimeout(1000)
    const signer = dlg.locator('input:not([type=checkbox])').last()
    if (!(await signer.inputValue())) await signer.fill('Waleed Al-Asiri')
    await dlg.locator('input[type=checkbox]').last().check()
    const pad = await dlg.locator('canvas').boundingBox()
    await n.mouse.move(pad.x + 30, pad.y + pad.height / 2); await n.mouse.down()
    for (let i = 1; i <= 12; i++) await n.mouse.move(pad.x + 30 + i * 18, pad.y + pad.height / 2 + (i % 2 ? -18 : 18), { steps: 3 })
    await n.mouse.up(); await n.waitForTimeout(500)
    await dlg.locator('button[type=submit]').click(); await n.waitForTimeout(3500)
    const row = sql(`select (w.appointment_id is not null) || '|' || p.full_name from pet_waivers w join profiles p on p.id = w.collected_by where w.pet_id = '${PET}' order by w.signed_at desc limit 1`)
    expect(+sql(`select count(*) from pet_waivers where pet_id = '${PET}'`) === before + 1, 'waiver not saved')
    expect(row.startsWith('true|') && /Huda/.test(row), 'waiver link/collector: ' + row)
  })

  await step(r, 'reminders: manager sees them; the message carries the clinic phone', async () => {
    const phone = sql(`select phone from clinics where id = '${clinicId}'`)
    expect(phone, 'demo clinic has no phone')
    const m = await login(browser, 'MohBaf@touq.app', PASS.cofounder)
    await m.goto(SITE + '/reminders'); await m.waitForTimeout(3500); await m.pick()
    const send = m.getByRole('link', { name: /^Send/ }).first()
    expect(await send.count(), 'manager sees no reminders to send')
    const text = decodeURIComponent((await send.getAttribute('href')).split('text=')[1] || '')
    await m.context().close()
    expect(text.includes('Questions: ' + phone) || text.includes('للاستفسار: ' + phone), 'no Questions line: ' + text.slice(-80))
  })

  await step(r, 'lock: two tabs lock and unlock together', async () => {
    const tab2 = await r.context().newPage()
    await tab2.goto(SITE + '/pets'); await tab2.waitForTimeout(3000)
    await r.goto(SITE + '/'); await r.waitForTimeout(2000); await r.pick()
    await r.evaluate(() => localStorage.setItem('touq.locked', '1')) // what the idle timer writes in the tab that locks
    await r.waitForTimeout(2500)
    expect(await r.locator('.lock-screen').count(), 'first tab did not lock')
    expect(await tab2.locator('.lock-screen').count(), 'second tab did not lock')
    await tab2.getByLabel(/Password/).fill(PASS.demoStaff)
    await tab2.getByRole('button', { name: 'Unlock' }).click(); await tab2.waitForTimeout(3500)
    expect((await tab2.locator('.lock-screen').count()) === 0, 'second tab still locked')
    expect((await r.locator('.lock-screen').count()) === 0, 'first tab still locked after the other unlocked')
    await tab2.close()
  })

  await step(r, 'phone paste: +966 number pasted into a phone field', async () => {
    await r.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await r.goto(SITE + '/pets/new'); await r.waitForTimeout(2500); await r.pick()
    const box = r.locator('.phone-input input')
    await box.click()
    await r.evaluate(() => navigator.clipboard.writeText('+966 50 123 4567'))
    await r.keyboard.press('Control+V'); await r.waitForTimeout(500)
    const v = (await box.inputValue()).replace(/\D/g, '')
    expect(v === '501234567', 'pasted phone became ' + v)
  })

  await step(r, 'Arabic device: first start (no saved language) is in Arabic', async () => {
    const ctx = await browser.newContext({ locale: 'ar-SA', timezoneId: 'Asia/Riyadh', viewport: { width: 820, height: 1180 } })
    const p = await ctx.newPage()
    await p.goto(SITE); await p.waitForTimeout(2500)
    const dir = await p.evaluate(() => document.documentElement.dir)
    const text = await p.locator('body').innerText()
    await p.screenshot({ path: out + 'j15-arabic-start.png' })
    await ctx.close()
    expect(dir === 'rtl' && /[؀-ۿ]{3,}/.test(text), `not Arabic: dir=${dir}`)
  })

  await step(r, 'week view: tap-to-book from a Tokyo device saves the Riyadh time shown', async () => {
    const t = await login(browser, 'amal.desk', PASS.demoStaff, { tz: 'Asia/Tokyo' })
    await t.goto(SITE + '/appointments'); await t.waitForTimeout(3500); await t.pick()
    await t.getByRole('button', { name: /^Week$/ }).click(); await t.waitForTimeout(2000)
    // Tomorrow's column (today may be in the past by now), the slot ~2 hours below the top of the grid.
    const cols = t.locator('.rbc-time-content .rbc-day-slot')
    const idx = Math.min(await cols.count() - 1, new Date(Date.now() + 86400000).getDay())
    const col = await cols.nth(idx).boundingBox()
    const area = await t.locator('.rbc-time-content').boundingBox()
    await t.mouse.click(col.x + col.width / 2, area.y + 200); await t.waitForTimeout(1500)
    const dlg = t.locator('[role=dialog]')
    expect(await dlg.count(), 'tapping the week grid opened no booking form')
    const shown = `${await dlg.locator('input[type=date]').inputValue()} ${await dlg.getByLabel('Hour').inputValue()}:${await dlg.getByLabel('Minute').inputValue()} ${await dlg.locator('select').nth(2).inputValue()}`
    const reason = 'Sweep 1101 tokyo ' + RUN
    const box = dlg.locator('input[role=combobox]')
    await box.fill('10026'); await t.waitForTimeout(1500)
    await t.locator('.pet-picker-option').first().click(); await t.waitForTimeout(800)
    await dlg.getByLabel('Reason').fill(reason)
    const doc = dlg.locator('select').last()
    await doc.selectOption(await doc.locator('option', { hasText: 'Khalid' }).first().getAttribute('value'))
    await dlg.locator('button[type=submit]').first().click(); await t.waitForTimeout(2500)
    const anyway = dlg.getByRole('button', { name: /Schedule anyway/ })
    if (await anyway.count()) { await anyway.click(); await t.waitForTimeout(2500) }
    const ack = dlg.getByRole('checkbox')
    if (await ack.count()) { await ack.first().check(); await dlg.locator('button[type=submit]').first().click(); await t.waitForTimeout(2500) }
    await t.context().close()
    const saved = sql(`select to_char(scheduled_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD FMHH12:MI AM') from appointments where reason = '${reason}'`)
    expect(saved, 'not saved (form showed ' + shown + ')')
    const [date, hm, ap] = shown.split(' ')
    const [hh, mm] = hm.split(':')
    expect(saved === `${date} ${+hh}:${mm.padStart(2, '0')} ${ap}`, `form showed ${shown}, saved ${saved} (Riyadh)`)
    sql(`update appointments set status = 'cancelled', cancellation_category = 'other', cancellation_reason = 'Sweep cleanup' where reason = '${reason}'`)
    return `${shown} → ${saved}`
  })

  await step(r, 'quick search: Arabic, dark, phone', async () => {
    const p = await login(browser, 'amal.desk', PASS.demoStaff, { w: 390, h: 844, lang: 'ar', theme: 'dark' })
    await p.locator('.app-topbar').getByRole('button', { name: 'بحث' }).click(); await p.waitForTimeout(800)
    await p.keyboard.type('امل'); await p.waitForTimeout(1500)
    const results = await p.locator('.quick-search [role=option]').count()
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const wrong = await p.locator('.quick-search').innerText()
    await p.screenshot({ path: out + 'j15-quicksearch-ar-dark-phone.png' })
    await p.context().close()
    expect(results > 0, 'no results for امل')
    expect(over <= 0, 'sideways scroll ' + over)
    expect(!/\b(Search|Pages|Pets|Owners)\b/.test(wrong), 'English in the Arabic quick search: ' + wrong.slice(0, 120))
  })

  await step(r, 'money: dashboard, Payments and the database agree on today', async () => {
    const m = await login(browser, 'MohBaf@touq.app', PASS.cofounder)
    const dayStart = `(date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh')`
    const db = sql(`select coalesce(sum(amount), 0)::numeric(12,2) || '|' || count(*) from invoice_payments where clinic_id = '${clinicId}' and paid_at >= ${dayStart}`)
    await m.goto(SITE + '/'); await m.waitForTimeout(4000); await m.pick()
    const tile = m.locator('.dash-strip-item', { hasText: "Today's payments" })
    const dash = (await tile.locator('.dash-strip-number').innerText()).replace(/,/g, '')
    await m.goto(SITE + '/payments'); await m.waitForTimeout(4000); await m.pick()
    const page = await m.locator('main').innerText()
    await m.context().close()
    const [sum, count] = db.split('|')
    expect(Number(dash) === Number(sum), `dashboard ${dash} vs database ${sum} (${count} payments)`)
    expect(page.replace(/,/g, '').includes(Number(sum).toFixed(2)), `Payments page does not show ${sum}`)
    return `${sum} SAR in ${count} payments on all three`
  })

  await step(d, 'screenshots for the user: doctor dashboard on a tablet (3 tiles)', async () => {
    const p = await login(browser, 'khalid.vet', PASS.demoStaff, { w: 820, h: 1180 })
    await p.goto(SITE + '/'); await p.waitForTimeout(4000); await p.pick()
    await p.screenshot({ path: out + 'j15-doctor-dashboard-tablet.png', fullPage: true })
    await p.context().close()
  })

  sql(`delete from visit_templates where name = '${TEMPLATE}'`)
  await browser.close()
  console.log(failed ? `${failed} FAILED` : 'all passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
