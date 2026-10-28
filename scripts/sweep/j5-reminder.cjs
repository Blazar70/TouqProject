// Sweep script (saved 10-28; see README.md). Staging only.
// Journey 5 (demo clinic): WhatsApp reminder send + undo. Prints: print.cjs. Removing staff: removed-staff-login.cjs (row-scoped).
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
async function login(b, user, pass, lang = 'en') {
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript((l) => { localStorage.setItem('touq-language', l) }, lang)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  p.pick = async () => { const bp = p.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first(); if (await bp.count()) { await bp.click(); await p.waitForTimeout(2000) } }
  await p.goto(SITE); await p.fill('input[autocomplete=username]', user); await p.fill('input[type=password]', pass)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000); await p.pick()
  return p
}
async function step(p, name, fn) { try { await fn(); console.log('ok', name) } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 160)); await p.screenshot({ path: out + `j5-fail-${name.replace(/\W+/g, '-')}.png` }) } }
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const r = await login(b, 'amal.desk', PASS.demoStaff)
  await step(r, 'reminder send + undo', async () => {
    await r.goto(SITE + '/reminders'); await r.waitForTimeout(3500); await r.pick()
    const send = r.getByRole('link', { name: /^Send on WhatsApp|^Send/ }).first()
    const href = await send.getAttribute('href')
    const text = decodeURIComponent(href.split('text=')[1] || '')
    console.log('  link:', href.split('?')[0], '| has Arabic:', /[\u0600-\u06FF]/.test(text), '| has English:', /[A-Za-z]{4}/.test(text))
    console.log('  message start:', text.replace(/\s+/g, ' ').slice(0, 110))
    const [popup] = await Promise.all([r.waitForEvent('popup', { timeout: 5000 }).catch(() => null), send.click()])
    if (popup) await popup.close() // never actually open WhatsApp: the numbers are made up
    await r.waitForTimeout(2500)
    const undo = r.getByRole('button', { name: /^Undo$/ }).first()
    console.log('  marked sent:', await undo.count() > 0)
    await undo.click(); await r.waitForTimeout(2500)
  })
  await b.close()
})()
