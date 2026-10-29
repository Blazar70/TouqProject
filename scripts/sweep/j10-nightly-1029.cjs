// Sweep script (10-29; see README.md). Staging only. Checks the fixes for the 10-29 nightly report:
// B25 idle sign-out waits 60 min on unsaved typing and saves the visit record first · B24 idle sign-out leaves
// push_subscriptions alone · B27 prescription lines keep their breaks · H36 weight range · B26/H37 import of an
// Arabic-Windows (1256) CSV shows readable names, and a second run skips the pets already there.
const fs = require('fs')
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const PET = '30359b93-8e11-481b-988c-e84be20ff062'
const RUN = Date.now().toString().slice(-5)
const REASON = 'Sweep 1029b ' + RUN
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
let failed = 0

async function login(browser, user, pass, { fakeClock = false } = {}) {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript(() => { localStorage.setItem('touq-language', 'en'); localStorage.setItem('touq-theme', 'light') })
  if (fakeClock) await ctx.clock.install()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  await page.goto(SITE)
  await page.fill('input[autocomplete=username]', user)
  await page.fill('input[type=password]', pass)
  await page.click('form.login-form button[type=submit]')
  await page.waitForTimeout(4000)
  const pick = page.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first()
  if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500) }
  return page
}
async function step(page, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 200))
    await page.screenshot({ path: out + `j10-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {})
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg) }

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })

  // ---- reception books + arrives; doctor (fake clock) starts the session and types without saving
  const r = await login(browser, 'amal.desk', PASS.demoStaff)
  let APPT = null
  await step(r, 'reception books + arrives', async () => {
    await r.goto(SITE + '/appointments?pet=' + PET)
    await r.waitForSelector('[role=dialog] input[type=date]', { timeout: 8000 })
    const dlg = r.locator('[role=dialog]')
    await dlg.locator('input[type=date]').fill(today)
    await dlg.getByLabel('Hour').selectOption('10')
    await dlg.getByLabel('Minute').selectOption('45')
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

  const d = await login(browser, 'khalid.vet', PASS.demoStaff, { fakeClock: true })
  const pushCalls = []
  d.on('request', (req) => req.url().includes('/push_subscriptions') && req.method() === 'DELETE' && pushCalls.push(req.url()))
  await step(d, 'unsaved visit: no sign-out at 10 min, saved + signed out at 60, push kept', async () => {
    expect(APPT, 'no appointment')
    await d.goto(SITE + '/appointments?open=' + APPT); await d.waitForTimeout(3000)
    await d.getByRole('button', { name: /Start session/ }).first().click()
    await d.waitForURL(/\/session/, { timeout: 8000 }); await d.waitForTimeout(2500)
    await d.getByLabel(/Presenting complaint/i).fill('Sweep idle: typed, never saved')
    await d.clock.fastForward('15:00')
    expect(await d.getByLabel(/Presenting complaint/i).count(), 'signed out at 15 min despite unsaved typing')
    await d.clock.fastForward('44:30')
    expect(await d.getByRole('alertdialog').filter({ hasText: /signed out in/ }).count(), 'no warning before the 60-min sign-out')
    await d.clock.fastForward('01:00')
    await d.locator('input[autocomplete=username]').waitFor({ timeout: 10000 })
    const saved = sql(`select presenting_complaint from medical_records where appointment_id = '${APPT}'`)
    expect(saved === 'Sweep idle: typed, never saved', 'record not saved before sign-out: ' + saved)
    expect(pushCalls.length === 0, 'idle sign-out deleted a push subscription')
  })

  // ---- doctor: prescription line breaks + weight range (normal clock)
  const d2 = await login(browser, 'khalid.vet', PASS.demoStaff)
  await step(d2, 'record values keep line breaks; weight range shown', async () => {
    await d2.goto(SITE + '/pets/' + PET); await d2.waitForTimeout(3500)
    await d2.locator('.record-accordion-header').first().click(); await d2.waitForTimeout(800)
    const ws = await d2.locator('.record-field').first().evaluate((e) => getComputedStyle(e).whiteSpace)
    expect(ws === 'pre-line', 'record field white-space: ' + ws)
    expect(await d2.locator('.weight-chart-range').filter({ hasText: /Range:/ }).count(), 'no weight range')
    await d2.locator('.weight-chart').screenshot({ path: out + 'j10-weight.png' })
  })

  // ---- admin import: Windows-1256 file, then the same file again
  // "سارة" and "هر" in Windows-1256; header + one row per pet.
  const ar = (bytes) => Buffer.from(bytes)
  const csv = Buffer.concat([
    Buffer.from(`owner_name,owner_phone,pet_name,species\r\n`),
    ar([0xd3, 0xc7, 0xd1, 0xc9]), Buffer.from(`,0558${RUN}0,Sweep1256 ${RUN},Cat\r\n`),
  ])
  const file = out + 'j10-import-1256.csv'
  fs.writeFileSync(file, csv)
  const a = await login(browser, 'staging.admin', PASS.admin)
  await step(a, 'import: Arabic-Windows file reads right; second run skips', async () => {
    await a.goto(SITE + '/clinics'); await a.waitForTimeout(3500)
    await a.locator('.record-accordion-header', { has: a.locator('strong', { hasText: /^Clinic A$/ }) }).click(); await a.waitForTimeout(1500)
    for (const run of [1, 2]) {
      await a.getByRole('button', { name: 'Import owners & pets' }).click()
      const dlg = a.getByRole('dialog')
      await dlg.locator('input[type=file]').setInputFiles(file); await a.waitForTimeout(1000)
      expect(await dlg.locator('.import-preview td', { hasText: 'سارة' }).count(), 'preview does not show the Arabic name')
      if (run === 1) await dlg.screenshot({ path: out + 'j10-import-preview.png' })
      await dlg.getByRole('button', { name: 'Import' }).click(); await a.waitForTimeout(3000)
      if (run === 2) expect(await a.getByText(/1 pets were already there/).count(), 'second run did not report the skip')
    }
    expect(sql(`select count(*) || ':' || min(owner_name) from pets where name = 'Sweep1256 ${RUN}'`) === '1:سارة', 'pet doubled or name garbled')
  })

  await browser.close()
  console.log(failed ? `DONE with ${failed} failure(s)` : 'DONE all passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.log('CRASH', e.message); process.exit(1) })
