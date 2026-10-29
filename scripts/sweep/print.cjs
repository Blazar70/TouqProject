// Sweep script (saved 10-28; see README.md). Staging only.
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS } = require('./config.cjs')
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' }); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('touq-language', 'ar'))
  const r = await ctx.newPage()
  await r.goto(SITE); await r.fill('input[autocomplete=username]', 'amal.desk'); await r.fill('input[type=password]', PASS.demoStaff)
  await r.click('form.login-form button[type=submit]'); await r.waitForTimeout(4000)
  for (const size of ['a4', '80mm']) {
    await r.evaluate((s) => localStorage.setItem('touq-receipt-size', s), size)
    await r.goto(SITE + '/payments?invoice=' + process.argv[2] + ''); await r.waitForTimeout(4000)
    const bp = r.locator('.branch-picker-list button').first(); if (await bp.count()) { await bp.click(); await r.waitForTimeout(2000) }
    const btn = r.locator('[role=dialog]').last().getByRole('button', { name: /^طباعة/ }).first()
    const [pw] = await Promise.all([r.waitForEvent('popup', { timeout: 8000 }), btn.click()])
    await pw.waitForTimeout(2000)
    const html = await pw.content()
    console.log(size, '| QR:', html.includes('print-qr'), '| 80mm styles:', html.includes('80mm auto'), '| bilingual spans:', html.includes('bi-ar'), '| VAT line:', /VAT/.test(html), '| total 253:', html.includes('253.00'))
    await pw.screenshot({ path: out + 'print-' + size + '.png', fullPage: true }).catch(() => {})
    await pw.close()
  }
  await b.close()
})().catch((e) => console.log('FAIL', e.message.split('\n')[0]))
