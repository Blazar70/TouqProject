// Sweep script (saved 10-28; see README.md). Staging only.
// Journey 2 with saves (demo clinic): doctor admits Sunny -> nurse adds an update -> doctor discharges -> reception bills the stay.
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const PET = SITE + '/pets/30359b93-8e11-481b-988c-e84be20ff062'
async function login(browser, user, pass, lang = 'en') {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript((l) => { localStorage.setItem('touq-language', l); localStorage.setItem('touq-theme', 'light') }, lang)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  p.on('console', (m) => m.type() === 'error' && console.log('  console', m.text().slice(0, 140)))
  await p.goto(SITE)
  await p.fill('input[autocomplete=username]', user)
  await p.fill('input[type=password]', pass)
  await p.click('form.login-form button[type=submit]')
  await p.waitForTimeout(4000)
  const pick = p.locator('.branch-picker-list button').first()
  if (await pick.count()) { await pick.click(); await p.waitForTimeout(1500) }
  return p
}
const panel = (p) => p.locator('#pet-inpatient, .inpatient-panel').first()
async function step(p, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 160)); await p.screenshot({ path: out + `stay-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true }); throw e
  }
}
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const d = await login(browser, 'khalid.vet', PASS.demoStaff)
  if (process.argv[2] === 'resume') { await resume(browser, d); return }
  await step(d, 'doctor admits', async () => {
    await d.goto(PET); await d.waitForTimeout(3500); { const bp = d.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first(); if (await bp.count()) { await bp.click(); await d.waitForTimeout(2500) } }
    await panel(d).getByRole('button', { name: /^Admit$/ }).click()
    await panel(d).getByLabel(/Reason/).fill('Sweep: observation after sprain')
    await panel(d).getByRole('button', { name: /^Admit at/ }).click()
    await d.waitForTimeout(3000)
    if (!/Day 1/.test(await panel(d).innerText())) throw new Error('no "Day 1" after admitting')
  })
  const n = await login(browser, 'huda.nurse', PASS.demoStaff, 'ar')
  await step(n, 'nurse adds an update (Arabic)', async () => {
    await n.goto(PET); await n.waitForTimeout(3500); { const bp = n.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first(); if (await bp.count()) { await bp.click(); await n.waitForTimeout(2500) } }
    const form = panel(n).locator('form').last()
    await form.locator('textarea').fill('Sweep: eating well, walking better')
    await form.locator('input[inputmode=decimal]').first().fill('٣٨٫٥') // Arabic digits on purpose
    await form.locator('button[type=submit]').click()
    await n.waitForTimeout(3000)
    const txt = await panel(n).innerText()
    console.log('  update shows temperature 38.5:', /38[.,٫]5/.test(txt))
  })
  await resume(browser, d)
})().catch(() => process.exit(1))
async function resume(browser, d) {
  if (process.argv[2] !== 'bill') await step(d, 'doctor discharges', async () => {
    await d.goto(PET); await d.waitForTimeout(3500); { const bp = d.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first(); if (await bp.count()) { await bp.click(); await d.waitForTimeout(2500) } }
    await panel(d).getByRole('button', { name: /^Discharge$/ }).click()
    await d.waitForTimeout(800)
    const submit = panel(d).locator('form:has(input[type=radio]) button[type=submit]')
    console.log('  discharge button disabled before an outcome is picked:', await submit.isDisabled())
    await panel(d).locator('input[type=radio]').first().check()
    await submit.click()
    await d.waitForTimeout(1200)
    const c = d.getByRole('alertdialog'); if (await c.count()) await c.getByRole('button').last().click()
    await d.waitForTimeout(3000)
  })
  const r = await login(browser, 'amal.desk', PASS.demoStaff)
  await step(r, 'reception bills the stay', async () => {
    await r.goto(PET); await r.waitForTimeout(3500); { const bp = r.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first(); if (await bp.count()) { await bp.click(); await r.waitForTimeout(2500) } }
    await r.getByText('Bill this stay', { exact: true }).first().click()
    await r.waitForURL(/\/payments/, { timeout: 8000 }); await r.waitForTimeout(3000)
    await r.screenshot({ path: out + 'stay-bill-form.png' })
    await r.getByRole('button', { name: /Create invoice/ }).first().click()
    await r.waitForTimeout(4000)
    console.log('  invoice:', (await r.locator('[role=dialog]').last().innerText()).replace(/\s+/g, ' ').slice(0, 180))
  })
  await browser.close()
}
