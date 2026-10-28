// Sweep script (saved 10-28; see README.md). Staging only.
// Journey with saves on the demo clinic (staging, reset after v2):
// reception books + checks in -> doctor runs the session -> reception bills + takes cash -> invoice paid.
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const PET = '30359b93-8e11-481b-988c-e84be20ff062'
const REASON = process.argv[2] || 'Sweep journey ' + Date.now().toString().slice(-5)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })

async function login(browser, user, pass) {
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
  const pick = page.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first()
  if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500) }
  return page
}
async function step(page, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 160))
    await page.screenshot({ path: out + `journey-fail-${name.replace(/\W+/g, '-')}.png` })
    throw e
  }
}
let APPT = null
const openAppt = async (page) => {
  if (!APPT) {
    const out = require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', "select id from appointments where reason = '" + REASON + "' order by created_at desc limit 1"]).toString().trim()
    if (!out) throw new Error('appointment not saved')
    APPT = out
    console.log('  appointment', APPT)
  }
  await page.goto(SITE + '/appointments?open=' + APPT)
  await page.waitForTimeout(3000)
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const r = await login(browser, 'amal.desk', PASS.demoStaff)
  await step(r, 'book from pet', async () => {
    await r.goto(SITE + '/appointments?pet=' + PET)
    await r.waitForSelector('[role=dialog] input[type=date]', { timeout: 8000 })
    const d = r.locator('[role=dialog]')
    await d.locator('input[type=date]').fill(today)
    await d.getByLabel('Hour').selectOption('11')
    await d.getByLabel('Minute').selectOption('45')
    await d.locator('select').nth(2).selectOption('AM')
    await d.getByLabel('Reason').fill(REASON)
    const doc = d.locator('select').last()
    const opt = await doc.locator('option', { hasText: 'Khalid' }).first().getAttribute('value')
    await doc.selectOption(opt)
    await d.locator('button[type=submit]').first().click()
    await r.waitForTimeout(2500)
    await r.screenshot({ path: out + 'journey-after-submit.png' })
    const anyway = d.getByRole('button', { name: /Schedule anyway/ })
    if (await anyway.count()) { await anyway.click(); await r.waitForTimeout(2500) }
    const ack = d.getByRole('checkbox')
    if (await ack.count()) { await ack.first().check(); await d.locator('button[type=submit]').first().click(); await r.waitForTimeout(2500) }
  })
  await step(r, 'confirm + arrived', async () => {
    await openAppt(r)
    const confirm = r.getByRole('button', { name: /^Confirm$/ })
    if (await confirm.count()) { await confirm.first().click(); await r.waitForTimeout(1500); await openAppt(r) }
    await r.getByRole('button', { name: /^Arrived$/ }).first().click()
    await r.waitForTimeout(2000)
  })
  const d = await login(browser, 'khalid.vet', PASS.demoStaff)
  await step(d, 'doctor starts session', async () => {
    await openAppt(d)
    await d.getByRole('button', { name: /Start session/ }).first().click()
    await d.waitForURL(/\/session/, { timeout: 8000 })
    await d.waitForTimeout(2000)
  })
  await step(d, 'doctor fills record + adds a service', async () => {
    await d.getByLabel(/Presenting complaint/i).fill('Sweep: limping right foreleg')
    await d.getByLabel(/Physical exam/i).fill('Sweep: mild swelling, no fracture felt')
    const vt = d.locator('form.session-form select').first()
    await vt.selectOption({ index: 1 })
    await d.getByLabel(/^Diagnosis/).fill('Sweep: soft-tissue sprain')
    await d.getByLabel(/^Treatment/).fill('Sweep: rest, anti-inflammatory')
    await d.screenshot({ path: out + 'journey-session.png', fullPage: true })
  })
  await step(d, 'doctor finishes', async () => {
    await d.getByRole('button', { name: /Finish session/ }).first().click()
    await d.waitForTimeout(1500)
    const c = d.getByRole('alertdialog')
    if (await c.count()) await c.getByRole('button').last().click()
    await d.waitForTimeout(3000)
    console.log('  after finish url:', d.url())
  })
  // Billing + payment: run j1b-bill-visit.cjs with this id.
  console.log('next: node scripts/sweep/j1b-bill-visit.cjs', APPT)
  await browser.close()
})().catch(() => process.exit(1))
