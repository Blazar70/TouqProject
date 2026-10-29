// Sweep script (saved 10-28; see README.md). Staging only.
// Prove: a removed staff member can't log in. Only touches "Sweep Test Nurse"; aborts if the confirm names anyone else.
const { chromium } = require('./config.cjs').playwright
const { SITE, PASS } = require('./config.cjs')
const NAME = 'Sweep Test Nurse'
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('touq-language', 'en'))
  const m = await ctx.newPage()
  await m.goto(SITE); await m.fill('input[autocomplete=username]', 'MohBaf@touq.app'); await m.fill('input[type=password]', PASS.cofounder)
  await m.click('form.login-form button[type=submit]'); await m.waitForTimeout(4000)
  const bp = m.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first(); if (await bp.count()) { await bp.click(); await m.waitForTimeout(2000) }
  await m.goto(SITE + '/staff'); await m.waitForTimeout(4000)
  const row = m.locator('li.pet-list-item').filter({ hasText: NAME })
  if ((await row.count()) !== 1) { console.log('ABORT: expected exactly one row for', NAME, 'got', await row.count()); return b.close() }
  await row.getByRole('button', { name: 'Remove staff member' }).click(); await m.waitForTimeout(1000)
  const c = m.getByRole('alertdialog')
  const text = await c.innerText()
  if (!text.includes(NAME)) { console.log('ABORT: confirm names someone else:', text.slice(0, 80)); await c.getByRole('button', { name: /Cancel/ }).click(); return b.close() }
  await c.getByRole('button', { name: 'Remove staff member' }).click(); await m.waitForTimeout(3500)
  // Try to sign in as the removed nurse in a fresh browser.
  const ctx2 = await b.newContext(); await ctx2.addInitScript(() => localStorage.setItem('touq-language', 'en'))
  const p = await ctx2.newPage()
  await p.goto(SITE); await p.fill('input[autocomplete=username]', 'sweep.nurse'); await p.fill('input[type=password]', PASS.sweepNurse)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4500)
  const stillLogin = (await p.locator('form.login-form').count()) > 0
  console.log('removed nurse refused:', stillLogin, '| message:', (await p.locator('[role=alert]').allInnerTexts()).join(' ').slice(0, 140))
  await b.close()
})()
