// Sweep script (10-31 nightly research: an automatic accessibility check before each staging release). Staging only.
// Runs axe-core (WCAG 2.0/2.1 A + AA rules) on the main screens and prints the violations grouped by rule.
// Usage: node axe.cjs <user> <passKey> <ar|en> <light|dark> <w> <h> <label> [admin]
// axe is loaded from cdnjs into the page (pinned), so it is not a project dependency. Screen readers in Arabic
// (VoiceOver on the iPad) are still a manual check: no tool covers them.
const { chromium } = require('./config.cjs').playwright
const { SITE, PASS } = require('./config.cjs')
const AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
const [user, passKey, lang, theme, w, h, label, admin] = process.argv.slice(2)
const pass = PASS[passKey]
const CLINIC = ['/', '/appointments', '/pets', '/pets/30359b93-8e11-481b-988c-e84be20ff062', '/owners', '/inpatients', '/reminders', '/payments', '/reports', '/staff', '/settings', '/pets/new']
const ADMIN = ['/', '/clinics', '/billing', '/activity']
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: +w, height: +h }, hasTouch: +w < 1000 })
  await ctx.addInitScript(([l, th]) => { localStorage.setItem('touq-language', l); localStorage.setItem('touq-theme', th) }, [lang, theme])
  const page = await ctx.newPage()
  await page.goto(SITE)
  await page.fill('input[autocomplete=username]', user)
  await page.fill('input[type=password]', pass)
  await page.click('form.login-form button[type=submit]')
  await page.waitForTimeout(4000)
  const pick = page.locator('.branch-picker-list button').first()
  if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500) }
  console.log(`### axe ${label} (${user}, ${lang}, ${theme}, ${w}x${h})`)
  const byRule = new Map()
  for (const route of admin ? ADMIN : CLINIC) {
    await page.goto(SITE + route)
    await page.waitForTimeout(3500)
    await page.addScriptTag({ url: AXE })
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(' ') + (n.any[0]?.data?.contrastRatio ? ` ${n.any[0].data.contrastRatio}:1 ${n.any[0].data.fgColor} on ${n.any[0].data.bgColor}` : '')).slice(0, 4), count: v.nodes.length }))
    })
    console.log(`${violations.length ? '!!' : 'ok'} ${route}${violations.length ? ' ' + violations.map((v) => `${v.id}(${v.count})`).join(' ') : ''}`)
    for (const v of violations) {
      const seen = byRule.get(v.id) ?? { ...v, targets: [], routes: [] }
      seen.routes.push(route)
      seen.targets.push(...v.targets.filter((t) => !seen.targets.includes(t)))
      byRule.set(v.id, seen)
    }
  }
  console.log('--- by rule')
  for (const v of byRule.values()) console.log(`${v.impact} ${v.id}: ${v.help} | on ${v.routes.join(', ')} | e.g.\n    ${v.targets.slice(0, 12).join('\n    ')}`)
  await browser.close()
  process.exit(byRule.size ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
