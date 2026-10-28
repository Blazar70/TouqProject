// Sweep script (saved 10-28; see README.md). Staging only.
// Opens each form / pop-up WITHOUT saving and checks it. Usage: node sweep-forms.cjs <user> <pass> <w> <h> <label>
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const [user, passKey, w, h, label] = process.argv.slice(2)
const pass = PASS[passKey] // a key from config.cjs PASS (e.g. demoStaff), so no password is typed on the command line
const PET_STAY = '/pets/b4fee9a0-64e4-409a-b7cf-37b9b3cb23e8'
const PET_REC = '/pets/30359b93-8e11-481b-988c-e84be20ff062'
// [name, route, button text (EN), what to scan]
const FORMS = [
  ['booking', '/appointments', /^\+?\s*New appointment$/],
  ['appt-details', '/appointments', 'event'],
  ['record-payment', '/payments', /Record payment/],
  ['invoice-detail', '/payments?invoice=d8ac35df-9950-4cc4-aba4-770b8fe2af8f', null],
  ['credit-note', '/payments?invoice=d8ac35df-9950-4cc4-aba4-770b8fe2af8f', /Issue credit note/],
  ['owner-open', '/owners', /^Open$/],
  ['owner-balance', '/owners', [/^Open$/, /Add balance/]],
  ['pet-edit', PET_REC, /^Edit$/],
  ['pet-record-open', PET_REC, 'accordion'],
  ['waiver-collect', PET_REC, /Collect a signature/],
  ['admit', PET_REC, /^Admit/],
  ['stay-update', PET_STAY, /Add update/],
  ['discharge', PET_STAY, /^Discharge$/],
  ['staff-add', '/staff', /Add a staff member/],
  ['time-off', '/staff', /Add time off/],
  ['register-pet', '/pets/new', null],
  ['settings', '/settings', null],
]
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: +w, height: +h }, hasTouch: +w < 1000 })
  await ctx.addInitScript(() => { localStorage.setItem('touq-language', 'en'); localStorage.setItem('touq-theme', 'light') })
  const page = await ctx.newPage()
  let errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 140)))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 140)))
  page.on('dialog', (d) => d.dismiss()) // never accept a browser confirm
  await page.goto(SITE)
  await page.fill('input[autocomplete=username]', user)
  await page.fill('input[type=password]', pass)
  await page.click('form.login-form button[type=submit]')
  await page.waitForTimeout(4000)
  const pick = page.locator('.branch-picker-list button').first()
  if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500) }
  console.log(`### forms ${label} (${user}, ${w}x${h})`)
  for (const [name, route, action] of FORMS) {
    errors = []
    await page.goto(SITE + route)
    await page.waitForTimeout(3500)
    let opened = 'page'
    const steps = Array.isArray(action) ? action : action ? [action] : []
    try {
      for (const step of steps) {
        if (step === 'event') await page.locator('.rbc-event').first().click({ timeout: 4000 })
        else if (step === 'accordion') await page.locator('.record-accordion-header').first().click({ timeout: 4000 })
        else await page.getByRole('button', { name: step }).or(page.getByRole('link', { name: step })).first().click({ timeout: 4000 })
        await page.waitForTimeout(1200)
      }
    } catch { console.log(`-- ${name}: control not found for this role (${steps.map(String).join(' > ')})`); continue }
    const r = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')].filter((d) => d.offsetParent !== null || d.getClientRects().length).pop()
      const root = dlg || document.querySelector('main') || document.body
      const fields = [...root.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea')].filter((el) => el.offsetParent !== null)
      const unlabeled = fields.filter((el) => !el.closest('label') && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !(el.id && document.querySelector(`label[for="${el.id}"]`)))
        .map((el) => `${el.tagName.toLowerCase()}[${el.type || ''}] ${el.placeholder || el.name || ''}`.slice(0, 40))
      const small = [...root.querySelectorAll('button, a, input:not([type=checkbox]):not([type=radio]), select, textarea')]
        .filter((el) => el.offsetParent !== null).map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && Math.min(r.height, r.width) < 24)
        .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
      const offscreen = dlg ? (() => { const b = dlg.getBoundingClientRect(); return b.bottom > innerHeight + 2 && getComputedStyle(dlg).overflowY === 'visible' ? `dialog ${Math.round(b.height)}px tall, no scroll` : null })() : null
      return { dialog: Boolean(dlg), title: (dlg?.querySelector('h2,h3')?.innerText || '').slice(0, 30), focusInside: dlg ? dlg.contains(document.activeElement) : null, fields: fields.length, unlabeled: [...new Set(unlabeled)].slice(0, 5), small: [...new Set(small)].slice(0, 5), offscreen }
    })
    let escapeCloses = null
    if (r.dialog) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(500)
      escapeCloses = !(await page.evaluate(() => [...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')].some((d) => d.getClientRects().length)))
    }
    const problems = []
    if (r.unlabeled.length) problems.push('unlabeled ' + JSON.stringify(r.unlabeled))
    if (r.small.length) problems.push('small ' + JSON.stringify(r.small))
    if (r.dialog && !r.focusInside) problems.push('focus not moved into pop-up')
    if (r.dialog && !escapeCloses) problems.push('Escape does not close')
    if (r.offscreen) problems.push(r.offscreen)
    if (errors.length) problems.push('errors ' + JSON.stringify(errors.slice(0, 2)))
    console.log(`${problems.length ? '!!' : 'ok'} ${name}: ${r.dialog ? `pop-up "${r.title}"` : 'inline'}, ${r.fields} fields` + (problems.length ? ' | ' + problems.join(' | ') : ''))
    await page.screenshot({ path: out + `forms-${label}-${name}.png` })
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
