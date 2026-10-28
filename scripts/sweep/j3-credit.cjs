// Sweep script (saved 10-28; see README.md). Staging only.
// Journey 3 (B22 in the UI): reception fully credits MAIN-000017 (visit ece1f542) -> visit not on Unpaid, "Bill this visit" back.
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const { execFileSync } = require('child_process')
const APPT = 'ece1f542-6dc4-4c49-b61e-086e87d4daea'
const sql = (q) => execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().trim()
const INV = sql(`select id from invoices where invoice_number = 'MAIN-000017' and clinic_id = (select id from clinics where name like 'Al Nakheel%')`)
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript(() => { localStorage.setItem('touq-language', 'en') })
  const r = await ctx.newPage()
  r.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  const pickBranch = async () => { const bp = r.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first(); if (await bp.count()) { await bp.click(); await r.waitForTimeout(2000) } }
  try {
    await r.goto(SITE); await r.fill('input[autocomplete=username]', 'amal.desk'); await r.fill('input[type=password]', PASS.demoStaff)
    await r.click('form.login-form button[type=submit]'); await r.waitForTimeout(4000); await pickBranch()
    await r.goto(SITE + '/payments?invoice=' + INV); await r.waitForTimeout(3500); await pickBranch()
    const dlg = r.locator('[role=dialog]').last()
    await dlg.getByRole('button', { name: /Issue credit note/ }).click(); await r.waitForTimeout(1000)
    const form = r.locator('form.invoice-action-form')
    console.log('  focus inside credit form:', await r.evaluate(() => !!document.activeElement?.closest('form.invoice-action-form')))
    for (const cb of await form.locator('input[type=checkbox]:not(:disabled)').all()) await cb.check()
    await form.getByLabel(/reason/i).fill('Sweep: visit made free (goodwill)')
    await form.locator('button[type=submit]').click(); await r.waitForTimeout(1500)
    const c = r.getByRole('alertdialog'); if (await c.count()) { console.log('  confirm asked:', (await c.innerText()).replace(/\s+/g, ' ').slice(0, 120)); await c.getByRole('button', { name: /Issue credit note/ }).click() }
    await r.waitForTimeout(3500)
    console.log('ok credited:', sql(`select payment_status, amount_credited, appointment_id is null, credited_appointment_id is not null from invoices where id='${INV}'`))
    await r.goto(SITE + '/reports'); await r.waitForTimeout(3000); await pickBranch()
    await r.getByRole('button', { name: /^Unpaid/ }).or(r.getByRole('tab', { name: /^Unpaid/ })).first().click(); await r.waitForTimeout(3500)
    const list = await r.locator('main').innerText()
    console.log('B22 check — Sunny visit of today on the Unpaid list:', /Sunny[\s\S]{0,80}Oct 28/.test(list) ? 'YES (bug)' : 'no (correct)')
    await r.screenshot({ path: out + 'credit-unpaid.png', fullPage: true })
    await r.goto(SITE + '/appointments?open=' + APPT); await r.waitForTimeout(3500); await pickBranch()
    console.log('"Bill this visit" offered again:', await r.getByRole('button', { name: /Bill this visit/ }).count() > 0)
  } catch (e) { console.log('FAIL', e.message.split('\n')[0].slice(0, 160)); await r.screenshot({ path: out + 'credit-fail.png' }) }
  await b.close()
})()
