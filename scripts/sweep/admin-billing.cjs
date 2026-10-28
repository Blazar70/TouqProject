// Sweep script (saved 10-28; see README.md). Staging only.
// Admin (staging.admin, AR light tablet): new clinic payment for test "Clinic A" -> status Paid -> delete it again.
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const { execFileSync } = require('child_process')
const sql = (q) => execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().trim()
const count = () => sql(`select count(*) from payments where amount = 1.23`)
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const ctx = await b.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true }); await ctx.addInitScript(() => localStorage.setItem('touq-language', 'en'))
  const a = await ctx.newPage(); a.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  try {
    await a.goto(SITE); await a.fill('input[autocomplete=username]', 'staging.admin'); await a.fill('input[type=password]', PASS.admin)
    await a.click('form.login-form button[type=submit]'); await a.waitForTimeout(4000)
    await a.goto(SITE + '/billing'); await a.waitForTimeout(3500)
    await a.getByRole('button', { name: /New payment/ }).click(); await a.waitForTimeout(600)
    const ci = a.locator('form').getByLabel('Clinic'); await ci.click(); await ci.fill('Clinic A'); await a.waitForTimeout(800)
    await a.locator('form li button', { hasText: /^Clinic A/ }).first().dispatchEvent('mousedown'); await a.waitForTimeout(500)
    await a.getByLabel(/^Amount/).fill('1.23')
    await a.getByRole('button', { name: /Create payment|Add payment|Save/ }).first().click(); await a.waitForTimeout(3000)
    console.log('ok created, rows with 1.23:', count())
    const row = a.locator('li, tr, .data-row').filter({ hasText: 'Clinic A' }).filter({ hasText: '1.23' }).first()
    await row.locator('select').selectOption('paid'); await a.waitForTimeout(2500)
    console.log('ok status:', sql(`select status, paid_at is not null from payments where amount = 1.23`))
    await row.getByRole('button', { name: /Delete/ }).click(); await a.waitForTimeout(800)
    const c = a.getByRole('alertdialog'); await c.getByRole('button', { name: 'Delete' }).click(); await a.waitForTimeout(3000)
    console.log('ok deleted, rows with 1.23:', count())
  } catch (e) { console.log('FAIL', e.message.split('\n')[0].slice(0, 160)); await a.screenshot({ path: out + 'admin-fail.png' }) }
  await b.close()
})()
