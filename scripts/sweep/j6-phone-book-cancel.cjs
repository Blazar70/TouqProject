// Sweep script (saved 10-28; see README.md). Staging only.
// Journey 6 on a phone (390x844, touch, AR): reception books Sunny for tomorrow, then cancels it with a reason.
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const { execFileSync } = require('child_process')
const sql = (q) => execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().trim()
const REASON = 'Sweep phone ' + Date.now().toString().slice(-5)
const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await ctx.addInitScript(() => { localStorage.setItem('touq-language', 'ar') })
  const r = await ctx.newPage()
  r.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  const pick = async () => { const bp = r.locator('.branch-picker-list button', { hasText: 'العليا' }).first(); if (await bp.count()) { await bp.click(); await r.waitForTimeout(2000) } }
  try {
    await r.goto(SITE); await r.fill('input[autocomplete=username]', 'amal.desk'); await r.fill('input[type=password]', PASS.demoStaff)
    await r.click('form.login-form button[type=submit]'); await r.waitForTimeout(4000); await pick()
    await r.goto(SITE + '/appointments?pet=30359b93-8e11-481b-988c-e84be20ff062'); await r.waitForTimeout(3500); await pick()
    const d = r.locator('[role=dialog]')
    const box = await d.boundingBox()
    console.log('booking pop-up fits the phone width:', box && box.x >= 0 && box.x + box.width <= 391)
    await d.locator('input[type=date]').fill(tomorrow)
    const sel = d.locator('select')
    await sel.nth(0).selectOption('10'); await sel.nth(1).selectOption('00'); await sel.nth(2).selectOption('AM')
    await d.locator('input:not([type=date])').last().fill(REASON)
    const doc = sel.last(); await doc.selectOption((await doc.locator('option', { hasText: 'Khalid' }).first().getAttribute('value')))
    await r.screenshot({ path: out + 'phone-booking.png' })
    await d.locator('button[type=submit]').first().tap(); await r.waitForTimeout(2500)
    const anyway = d.getByRole('button', { name: /رغم|anyway/i }); if (await anyway.count()) { await anyway.tap(); await r.waitForTimeout(2500) }
    const id = sql(`select id from appointments where reason = '${REASON}'`)
    console.log('ok booked on phone:', !!id, sql(`select scheduled_at at time zone 'Asia/Riyadh' from appointments where id='${id}'`))
    await r.goto(SITE + '/appointments?open=' + id); await r.waitForTimeout(3500); await pick()
    await r.getByRole('button', { name: 'إلغاء الموعد' }).tap(); await r.waitForTimeout(1200)
    const p = r.locator('[role=dialog]')
    await p.locator('select').first().selectOption({ index: 1 })
    await r.screenshot({ path: out + 'phone-cancel.png' })
    await p.getByRole('button', { name: 'تأكيد الإلغاء' }).tap(); await r.waitForTimeout(3000)
    console.log('ok cancelled on phone:', sql(`select status, cancellation_category from appointments where id='${id}'`))
  } catch (e) { console.log('FAIL', e.message.split('\n')[0].slice(0, 160)); await r.screenshot({ path: out + 'phone-fail.png' }) }
  await b.close()
})()
