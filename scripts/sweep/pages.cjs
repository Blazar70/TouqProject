// Sweep script (saved 10-28; see README.md). Staging only.
// Read-only sweep slice on the staging site. Usage: node sweep.cjs <user> <pass> <ar|en> <light|dark> <w> <h> <label> [admin]
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS } = require('./config.cjs')
const [user, passKey, lang, theme, w, h, label, admin] = process.argv.slice(2)
const pass = PASS[passKey] // a key from config.cjs PASS (e.g. demoStaff), so no password is typed on the command line
const CLINIC = ['/', '/appointments', '/pets', '/pets/b4fee9a0-64e4-409a-b7cf-37b9b3cb23e8', '/pets/30359b93-8e11-481b-988c-e84be20ff062',
  '/owners', '/inpatients', '/reminders', '/payments', '/payments?invoice=d8ac35df-9950-4cc4-aba4-770b8fe2af8f', '/reports', '/staff', '/settings', '/manager', '/pets/new']
const ADMIN = ['/', '/clinics', '/billing', '/activity']
const EN = /\b(Save|Cancel|Delete|Edit|Search|Add|Showing|Loading|Back|Close|Confirm|Print|Today|Pending|Paid|Unpaid|Status|Total|Name|Phone|Owner|Pet|Appointment|Invoice|Payment|Settings|Required|Select|Choose|Next|Previous|Week|Day|Refresh|Open|Send|Skip)\b/
// Arabic letters on an English screen (names excluded by needing 2+ Arabic words outside data cells is too fuzzy: just count).
const AR = /[\u0600-\u06FF]{3,}/
;(async () => {
  require('fs').mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: +w, height: +h }, hasTouch: +w < 1000 })
  await ctx.addInitScript(([l, th]) => { localStorage.setItem('touq-language', l); localStorage.setItem('touq-theme', th) }, [lang, theme])
  const page = await ctx.newPage()
  let errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 140)))
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 140)))
  await page.goto(SITE)
  await page.fill('input[autocomplete=username]', user)
  await page.fill('input[type=password]', pass)
  await page.click('form.login-form button[type=submit]')
  await page.waitForTimeout(4000)
  const pick = page.locator('.branch-picker-list button').first()
  if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500) }
  console.log(`### ${label} (${user}, ${lang}, ${theme}, ${w}x${h})`)
  for (const route of admin ? ADMIN : CLINIC) {
    errors = []
    await page.goto(SITE + route)
    await page.waitForTimeout(3500)
    const r = await page.evaluate(([enSrc, arSrc, lang]) => {
      const bad = new RegExp(lang === 'ar' ? enSrc : arSrc)
      const main = document.querySelector('main') || document.body
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
      const wrong = new Set()
      for (let n; (n = walker.nextNode()); ) {
        const s = n.textContent.trim(), el = n.parentElement
        if (s && bad.test(s) && el.offsetParent !== null && !el.closest('[dir=ltr], bdi, td, .record-row strong, h3, option')) wrong.add(s.slice(0, 50))
      }
      const small = [...main.querySelectorAll('button, a, input, select, textarea, [role=button]')]
        .filter((el) => el.offsetParent !== null && !el.closest('.mini-month-grid'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && Math.min(r.height, r.width) < 24)
        .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
      const unlabeled = [...main.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((el) => el.offsetParent !== null && !el.closest('label') && !el.getAttribute('aria-label') && !(el.id && document.querySelector(`label[for="${el.id}"]`))).map((el) => `${el.tagName.toLowerCase()}[${el.type || ''}] ${el.placeholder || el.name || ''}`.slice(0, 40))
      return { at: location.pathname + location.search.slice(0, 12), h1: document.querySelector('h1')?.innerText?.slice(0, 30), overflow, wrongLang: [...wrong].slice(0, 6), small: [...new Set(small)].slice(0, 5), unlabeled: [...new Set(unlabeled)].slice(0, 5) }
    }, [EN.source, AR.source, lang])
    const issues = r.overflow > 0 || r.wrongLang.length || r.small.length || r.unlabeled.length || errors.length
    console.log(`${issues ? '!!' : 'ok'} ${route} -> ${r.at} "${r.h1}"` + (issues ? ' ' + JSON.stringify({ overflow: r.overflow || undefined, wrongLang: r.wrongLang.length ? r.wrongLang : undefined, small: r.small.length ? r.small : undefined, unlabeled: r.unlabeled.length ? r.unlabeled : undefined, errors: errors.length ? errors.slice(0, 3) : undefined }) : ''))
    await page.screenshot({ path: out + `${label}-${route.replace(/[/?=]/g, '_').slice(0, 40) || 'root'}.png` })
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
