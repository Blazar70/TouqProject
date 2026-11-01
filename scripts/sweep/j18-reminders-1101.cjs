// Sweep script (11-01, H52; see README.md). Staging only. Marks one reminder sent, then undoes it.
// After a send, the next unsent reminder is highlighted and focused, and the "x of y done" count goes up.
// Run against a local build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j18-reminders-1101.cjs
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS } = require('./config.cjs')
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript(() => localStorage.setItem('touq-language', 'en'))
  const p = await ctx.newPage()
  try {
    await p.goto(SITE); await p.fill('input[autocomplete=username]', 'amal.desk'); await p.fill('input[type=password]', PASS.demoStaff)
    await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000)
    await p.goto(SITE + '/reminders'); await p.waitForTimeout(3500)
    const progress = async () => (await p.locator('.page-subtitle').innerText()).match(/(\d+) of (\d+) done/)
    const before = await progress()
    if (!before) throw new Error('no "x of y done" line: ' + (await p.locator('.page-subtitle').innerText()))
    const send = p.getByRole('link', { name: /^Send/ }).first()
    if (!(await send.count())) throw new Error('nothing to send on staging today')
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), send.click()])
    if (popup) await popup.close() // never open WhatsApp: the numbers are made up
    await p.waitForTimeout(3000)
    const after = await progress()
    const next = p.locator('li.reminder-next')
    const focusedInNext = await p.evaluate(() => !!document.activeElement?.closest('li.reminder-next'))
    await p.screenshot({ path: out + 'j18-reminders-next.png' })
    // Undo the test send (sent ones sit at the bottom of their section).
    await p.getByRole('button', { name: /^Undo$/ }).first().click(); await p.waitForTimeout(2500)
    if (+after[1] !== +before[1] + 1) throw new Error(`count ${before[0]} -> ${after[0]}`)
    if (+before[2] > 1 && (await next.count()) !== 1) throw new Error('no next reminder highlighted')
    if (+before[2] > 1 && !focusedInNext) throw new Error('focus is not on the next reminder')
    console.log(`ok H52: ${before[0]} -> ${after[0]}, next one highlighted and focused; test send undone`)
  } catch (e) {
    console.log('FAIL', e.message.split('\n')[0].slice(0, 200))
    await p.screenshot({ path: out + 'j18-fail.png', fullPage: true })
    process.exitCode = 1
  }
  await b.close()
})()
