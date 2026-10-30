// Sweep script (10-30 UI tips; see README.md). Staging only. Changes no data.
// Ctrl+K quick search (button with its key hint, pet found and opened by keyboard, Escape closes) -> lists come back
// instantly from the last visit -> tabular digits, balanced headings, clearer paw background.
// Money request keys (0102) are covered by supabase/tests/0102_request_keys_check.sql and by j11/j12 saving invoices.
// Run against a local build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j13-ui-tips-1030.cjs
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS } = require('./config.cjs')
const SUKKAR = '7b4fffe2-fa8d-4b73-a877-d389420a9a5e'
let failed = 0

async function step(page, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 200))
    await page.screenshot({ path: out + `j13-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true })
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg) }

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript(() => { localStorage.setItem('touq-language', 'en'); localStorage.setItem('touq-theme', 'light') })
  const r = await ctx.newPage()
  r.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  r.on('console', (m) => m.type() === 'error' && console.log('  console', m.text().slice(0, 140)))
  await r.goto(SITE)
  await r.fill('input[autocomplete=username]', 'amal.desk')
  await r.fill('input[type=password]', PASS.demoStaff)
  await r.click('form.login-form button[type=submit]')
  await r.waitForTimeout(4000)
  const pick = r.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first()
  if (await pick.count()) { await pick.click(); await r.waitForTimeout(1500) }

  await step(r, 'Ctrl+K finds and opens a pet by keyboard', async () => {
    expect(await r.locator('.nav-search .nav-kbd').innerText() === 'Ctrl K', 'search button lacks its Ctrl K hint')
    await r.keyboard.press('Control+k')
    const dlg = r.getByRole('dialog')
    await dlg.waitFor({ timeout: 3000 })
    expect(await dlg.getByRole('option', { name: /Payments/ }).count(), 'pages not listed when empty')
    await r.keyboard.type('امل'); await r.waitForTimeout(1200)
    expect(await dlg.getByRole('option', { name: /Sukkar/ }).count(), 'pet not found')
    while (!(await dlg.locator('.quick-search-option-active', { hasText: 'Sukkar' }).count())) await r.keyboard.press('ArrowDown')
    await r.keyboard.press('Enter'); await r.waitForTimeout(2500)
    expect(r.url().endsWith('/pets/' + SUKKAR), 'did not open the pet: ' + r.url())
    await r.keyboard.press('Control+k'); await dlg.waitFor({ timeout: 3000 })
    await r.keyboard.press('Escape'); await r.waitForTimeout(300)
    expect(!(await r.getByRole('dialog').count()), 'Escape did not close it')
  })
  await step(r, 'lists come back instantly from the last visit', async () => {
    await r.getByRole('link', { name: 'Owners' }).click(); await r.waitForTimeout(2500)
    await r.getByRole('link', { name: 'Pets' }).click()
    await r.waitForTimeout(150) // well before a fresh request returns
    expect(await r.locator('.pet-list-item:not(:has(.skeleton))').count() > 0, 'pets list not shown at once')
  })
  await step(r, 'tabular digits, balanced headings, clearer paws', async () => {
    const css = await r.evaluate(() => ({
      nums: getComputedStyle(document.body).fontVariantNumeric,
      wrap: getComputedStyle(document.querySelector('h1')).textWrap ?? getComputedStyle(document.querySelector('h1')).textWrapStyle,
      paws: getComputedStyle(document.body, '::before').backgroundImage,
    }))
    expect(css.nums === 'tabular-nums', 'digits: ' + css.nums)
    expect(/balance/.test(css.wrap), 'headings: ' + css.wrap)
    expect(css.paws.includes('0.16'), 'paw pattern not the clearer one')
    await r.screenshot({ path: out + 'j13-pets.png' })
  })

  console.log(failed ? `${failed} FAILED` : 'all passed')
  await browser.close()
  process.exit(failed ? 1 : 0)
})()
