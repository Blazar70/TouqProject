// Sweep script (10-29; see README.md). Staging only. Saves data on the demo clinic + "Clinic A" (reset after v2).
// The 10-29 batch: doctor makes a visit template -> reception books + arrives -> doctor applies the template in the
// session (diagnosis + prescription filled), saves, finishes -> pet file shows the prescription + weight chart ->
// idle warning + idle sign-out -> admin CSV import (bad file refused, good file imported).
const fs = require('fs')
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const PET = '30359b93-8e11-481b-988c-e84be20ff062'
const RUN = Date.now().toString().slice(-5)
const TEMPLATE = 'Sweep ear check ' + RUN
const REASON = 'Sweep 1029 ' + RUN
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim() // spsql prints CRLF on Windows
let failed = 0

async function login(browser, user, pass, branch = 'Al Olaya') {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript(() => { localStorage.setItem('touq-language', 'en'); localStorage.setItem('touq-theme', 'light') })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  page.on('console', (m) => m.type() === 'error' && console.log('  console', m.text().slice(0, 140)))
  await page.goto(SITE)
  await page.fill('input[autocomplete=username]', user)
  await page.fill('input[type=password]', pass)
  await page.click('form.login-form button[type=submit]')
  await page.waitForTimeout(4000)
  const pick = page.locator('.branch-picker-list button', { hasText: branch }).first()
  if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500) }
  return page
}
async function step(page, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 200))
    await page.screenshot({ path: out + `j9-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true })
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg) }

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })

  const ONLY_LATE = process.argv[2] === 'late' // rerun just idle + import
  // ---- doctor: template in Settings
  const d = ONLY_LATE ? null : await login(browser, 'khalid.vet', PASS.demoStaff)
  const r = await login(browser, 'amal.desk', PASS.demoStaff)
  let APPT = null
  if (!ONLY_LATE) {
  await step(d, 'doctor creates a visit template', async () => {
    await d.goto(SITE + '/settings'); await d.waitForTimeout(3000)
    await d.getByRole('button', { name: /Add a template/ }).click()
    await d.getByLabel('Template name').fill(TEMPLATE)
    const form = d.locator('form', { has: d.getByLabel('Template name') })
    await form.getByLabel(/^Diagnosis/).fill('Otitis externa')
    await form.getByLabel(/^Treatment/).fill('Ear cleaning + drops')
    await form.getByRole('button', { name: /Add medicine/ }).click()
    await form.getByLabel('Medicine').fill('Ear drops')
    await form.getByLabel('Dose').fill('3 drops')
    await form.getByLabel('How often').fill('twice a day')
    await form.getByLabel('For how long').fill('7 days')
    await form.getByRole('button', { name: /^Save$/ }).click()
    await d.waitForTimeout(2500)
    expect(sql(`select count(*) from visit_templates where name = '${TEMPLATE}' and prescription @> '[{"medicine": "Ear drops"}]'`) === '1', 'template not saved with its medicine')
  })

  // ---- reception: book + arrived (as j1-visit)
  await step(r, 'reception books + arrives', async () => {
    await r.goto(SITE + '/appointments?pet=' + PET)
    await r.waitForSelector('[role=dialog] input[type=date]', { timeout: 8000 })
    const dlg = r.locator('[role=dialog]')
    await dlg.locator('input[type=date]').fill(today)
    await dlg.getByLabel('Hour').selectOption('11')
    await dlg.getByLabel('Minute').selectOption('30')
    await dlg.locator('select').nth(2).selectOption('PM')
    await dlg.getByLabel('Reason').fill(REASON)
    const doc = dlg.locator('select').last()
    await doc.selectOption(await doc.locator('option', { hasText: 'Khalid' }).first().getAttribute('value'))
    await dlg.locator('button[type=submit]').first().click()
    await r.waitForTimeout(2500)
    const anyway = dlg.getByRole('button', { name: /Schedule anyway/ })
    if (await anyway.count()) { await anyway.click(); await r.waitForTimeout(2500) }
    const ack = dlg.getByRole('checkbox')
    if (await ack.count()) { await ack.first().check(); await dlg.locator('button[type=submit]').first().click(); await r.waitForTimeout(2500) }
    APPT = sql(`select id from appointments where reason = '${REASON}' order by created_at desc limit 1`)
    expect(APPT, 'appointment not saved')
    await r.goto(SITE + '/appointments?open=' + APPT); await r.waitForTimeout(3000)
    const confirm = r.getByRole('button', { name: /^Confirm$/ })
    if (await confirm.count()) { await confirm.first().click(); await r.waitForTimeout(1500); await r.goto(SITE + '/appointments?open=' + APPT); await r.waitForTimeout(3000) }
    await r.getByRole('button', { name: /^Arrived$/ }).first().click()
    await r.waitForTimeout(2000)
  })

  // ---- doctor: session with the template
  await step(d, 'doctor applies the template in the session', async () => {
    expect(APPT, 'no appointment')
    await d.goto(SITE + '/appointments?open=' + APPT); await d.waitForTimeout(3000)
    await d.getByRole('button', { name: /Start session/ }).first().click()
    await d.waitForURL(/\/session/, { timeout: 8000 }); await d.waitForTimeout(2500)
    await d.locator('form.session-form select').first().selectOption({ index: 1 })
    await d.getByLabel(/Presenting complaint/i).fill('Sweep: scratching right ear')
    await d.getByLabel(/^Weight/).fill('7.4')
    await d.getByLabel('Use a template').selectOption({ label: TEMPLATE })
    await d.waitForTimeout(800)
    expect((await d.getByLabel(/^Diagnosis/).inputValue()) === 'Otitis externa', 'diagnosis not filled from template')
    expect((await d.getByLabel('Medicine').first().inputValue()) === 'Ear drops', 'prescription line not added')
    expect((await d.getByLabel(/Presenting complaint/i).inputValue()) === 'Sweep: scratching right ear', 'typed complaint was replaced')
    await d.screenshot({ path: out + 'j9-session-template.png', fullPage: true })
  })
  await step(d, 'doctor finishes; record has the prescription', async () => {
    await d.getByRole('button', { name: /Finish session/ }).first().click()
    await d.waitForTimeout(1500)
    const c = d.getByRole('alertdialog')
    if (await c.count()) await c.getByRole('button').last().click()
    await d.waitForTimeout(3000)
    const rx = sql(`select prescription->0->>'frequency' from medical_records where appointment_id = '${APPT}'`)
    expect(rx === 'twice a day', 'prescription not saved: ' + rx)
  })
  await step(d, 'pet file: prescription shown + weight chart', async () => {
    await d.goto(SITE + '/pets/' + PET); await d.waitForTimeout(3500)
    await d.locator('.record-accordion-header').first().click(); await d.waitForTimeout(800)
    expect(await d.getByText(/Ear drops · 3 drops · twice a day · 7 days/).count(), 'prescription line not shown on the record')
    expect(await d.locator('.weight-chart').count(), 'no weight panel')
    expect(await d.locator('.weight-chart-plot circle').count() >= 2, 'chart has fewer than 2 points')
    await d.locator('.weight-chart').screenshot({ path: out + 'j9-weight-chart.png' })
  })
  await step(d, 'doctor deletes the sweep template', async () => {
    await d.goto(SITE + '/settings'); await d.waitForTimeout(3000)
    await d.locator('.record-list li', { hasText: TEMPLATE }).getByRole('button', { name: /^Delete$/ }).click()
    const c = d.getByRole('alertdialog')
    await c.waitFor({ timeout: 4000 })
    const ok = c.getByRole('button').first()
    await d.waitForTimeout(3500) // danger confirms unlock after a countdown
    await ok.click(); await d.waitForTimeout(2000)
    expect(sql(`select count(*) from visit_templates where name = '${TEMPLATE}'`) === '0', 'template not deleted')
  })

  } // !ONLY_LATE

  // ---- receptionist: no weight chart, no templates section
  await step(r, 'receptionist sees no weight chart or templates', async () => {
    await r.goto(SITE + '/pets/' + PET); await r.waitForTimeout(3500)
    expect((await r.locator('.weight-chart').count()) === 0, 'receptionist sees the weight chart')
    await r.goto(SITE + '/settings'); await r.waitForTimeout(3000)
    expect((await r.getByRole('heading', { name: 'Visit templates' }).count()) === 0, 'receptionist sees templates')
  })

  // ---- idle sign-out
  await step(r, 'idle warning, stay, then sign-out after 10 min', async () => {
    await r.clock.install() // fake time from here, so 10 minutes pass in a second
    await r.reload(); await r.waitForTimeout(4000)
    await r.clock.fastForward('09:30')
    const warn = r.getByRole('alertdialog').filter({ hasText: /signed out in/ })
    await warn.waitFor({ timeout: 5000 })
    await warn.getByRole('button', { name: 'Stay signed in' }).click()
    await r.clock.fastForward('00:05')
    expect((await warn.count()) === 0, 'warning stayed after Stay')
    await r.clock.fastForward('09:00')
    expect(await warn.count(), 'no second warning after 9 more idle minutes')
    await r.clock.fastForward('01:30')
    await r.locator('input[autocomplete=username]').waitFor({ timeout: 8000 })
  })
  await step(r, 'browser reopened after 10+ idle minutes starts signed out', async () => {
    const r2 = await login(browser, 'amal.desk', PASS.demoStaff)
    await r2.evaluate(() => localStorage.setItem('touq.lastActive', String(Date.now() - 11 * 60_000)))
    await r2.reload()
    await r2.locator('input[autocomplete=username]').waitFor({ timeout: 8000 })
  })

  // ---- admin import
  const bad = out + 'j9-import-bad.csv'
  const good = out + 'j9-import-good.csv'
  fs.writeFileSync(bad, '﻿owner_name,owner_phone,pet_name,species\r\nBad Phone,12345,Sweep Bad,Dog\r\n,0501112233,No Owner,Cat\r\n')
  fs.writeFileSync(good, `﻿owner_name,owner_phone,owner_email,pet_name,species,breed,date_of_birth\r\nسارة الاختبار,0559${RUN}0,,Sweep Import Cat ${RUN},cat,,01/03/2022\r\nسارة الاختبار,0559${RUN}0,,Sweep Import Dog ${RUN},Dog,Saluki,\r\n`)
  const a = await login(browser, 'staging.admin', PASS.admin)
  await step(a, 'admin import: bad file refused, good file imported', async () => {
    await a.goto(SITE + '/clinics'); await a.waitForTimeout(3500)
    await a.locator('.record-accordion-header', { has: a.locator('strong', { hasText: /^Clinic A$/ }) }).click(); await a.waitForTimeout(1500)
    await a.getByRole('button', { name: 'Import owners & pets' }).click()
    const dlg = a.getByRole('dialog')
    await dlg.locator('input[type=file]').setInputFiles(bad); await a.waitForTimeout(1000)
    expect(await dlg.getByText(/Line 2: the phone/).count(), 'bad phone not listed')
    expect(await dlg.getByText(/Line 3: owner name/).count(), 'missing owner not listed')
    expect(await dlg.getByRole('button', { name: 'Import' }).isDisabled(), 'Import enabled with errors')
    await dlg.locator('input[type=file]').setInputFiles(good); await a.waitForTimeout(1000)
    expect(await dlg.getByText(/Ready: 2 pets for up to 1 owners/).count(), 'preview wrong')
    await dlg.screenshot({ path: out + 'j9-import-preview.png' })
    await dlg.getByRole('button', { name: 'Import' }).click(); await a.waitForTimeout(3000)
    const rows = sql(`select p.species || ':' || coalesce(p.date_of_birth::text, '-') || ':' || o.phone from pets p join owner_files o on o.id = p.owner_file_id where p.name like 'Sweep Import % ${RUN}' order by p.name`)
    expect(rows === `Cat:2022-03-01:+9665590${RUN}`.replace(`0${RUN}`, `${RUN}0`) + `\nDog:-:+966559${RUN}0`, 'imported rows: ' + rows)
  })

  await browser.close()
  console.log(failed ? `DONE with ${failed} failure(s)` : 'DONE all passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.log('CRASH', e.message); process.exit(1) })
