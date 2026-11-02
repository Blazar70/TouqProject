// Sweep script (11-02: security headers; see README.md). Staging only, changes no data.
// Reads the response headers, then opens every main screen and print window as manager, doctor and admin, in Arabic
// and English, and fails on anything the Content-Security-Policy blocks (console errors, also in print windows).
// Run against a local build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j20-csp-1102.cjs
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
const CLINIC_ROUTES = ['/', '/appointments', '/pets', '/owners', '/inpatients', '/reminders', '/payments', '/reports', '/staff', '/settings', '/manager', '/pets/new']
const ADMIN_ROUTES = ['/', '/clinics', '/billing', '/activity']
const REQUIRED = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'content-security-policy']
const blocked = []
let failed = 0

async function login(browser, user, pass, lang) {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript((l) => { localStorage.setItem('touq-language', l); window.print = () => {} }, lang)
  const watch = (page) => page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) blocked.push(`${user} ${page.url().slice(0, 60)}: ${m.text().slice(0, 220)}`)
  })
  ctx.on('page', watch)
  const page = await ctx.newPage()
  await page.goto(SITE)
  await page.fill('input[autocomplete=username]', user)
  await page.fill('input[type=password]', pass)
  await page.click('form.login-form button[type=submit]')
  await page.waitForTimeout(4000)
  page.pick = async () => {
    const list = page.locator('.branch-picker-list button')
    if (await list.count()) { await list.first().click(); await page.waitForTimeout(1500) }
  }
  await page.pick()
  page.go = async (path) => {
    await page.evaluate((url) => { history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate')) }, path)
    await page.waitForTimeout(3000)
  }
  return page
}
async function step(page, name, fn) {
  try { const note = await fn(); console.log('ok', name + (note ? ' — ' + note : '')) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 200))
    await page?.screenshot({ path: out + `j20-fail-${name.replace(/\W+/g, '-').slice(0, 50)}.png` }).catch(() => {})
  }
}
async function printed(page, click) {
  const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 10000 }), click()])
  await popup.waitForLoadState()
  await popup.waitForTimeout(1500)
  const broken = await popup.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src.slice(0, 60)))
  const styled = await popup.evaluate(() => document.styleSheets.length)
  await popup.close()
  expect(styled > 0, 'print window lost its styles')
  expect(!broken.length, 'print window has broken images: ' + broken.join(', '))
}
const expect = (c, m) => { if (!c) throw new Error(m) }

;(async () => {
  await step(null, 'all six headers are sent, also on a deep link', async () => {
    for (const path of ['/', '/pets/some-id']) {
      const res = await fetch(SITE + path)
      const missing = REQUIRED.filter((h) => !res.headers.get(h))
      expect(!missing.length, `${path} is missing ${missing.join(', ')}`)
    }
  })

  const browser = await chromium.launch({ channel: 'chrome' })
  const m = await login(browser, 'MohBaf@touq.app', PASS.cofounder, 'ar')
  await step(m, 'manager (Arabic): every screen', async () => {
    for (const route of CLINIC_ROUTES) { await m.go(route) }
    return `${CLINIC_ROUTES.length} screens`
  })
  await step(m, 'prints: invoice with QR code and logo', async () => {
    const id = sql(`select i.id from invoices i join clinics c on c.id = i.clinic_id where c.name like 'Al Nakheel%' and i.tax_phase = 'phase1' and i.branch_id = (select id from branches where clinic_id = c.id and is_main) order by i.created_at desc limit 1`)
    await m.go('/payments?invoice=' + id)
    await printed(m, () => m.locator('[role=dialog]').last().getByRole('button', { name: /^طباعة$/ }).first().click())
  })
  await step(m, 'prints: report', async () => {
    await m.go('/reports')
    const button = m.getByRole('button', { name: /^طباعة$/ }).first()
    await button.waitFor({ timeout: 15000 })
    await printed(m, () => button.click())
  })

  const d = await login(browser, 'khalid.vet', PASS.demoStaff, 'en')
  const visit = sql(`select appointment_id from medical_records where photo_url is not null and prescription <> '[]' and appointment_id is not null order by created_at desc limit 1`)
  await step(d, 'prints: visit summary with a photo, and the prescription', async () => {
    expect(visit, 'no visit with a photo and prescription')
    await d.go('/appointments?open=' + visit)
    const dlg = d.locator('[role=dialog]')
    await d.waitForTimeout(1500)
    const photo = await dlg.locator('img').first().evaluate((i) => i.naturalWidth).catch(() => 0)
    expect(photo > 0, 'the visit photo did not load in the app')
    await printed(d, () => dlg.getByRole('button', { name: 'Print summary' }).click())
    await printed(d, () => dlg.getByRole('button', { name: 'Print prescription' }).click())
  })
  await step(d, 'waiver: signature pad and its print', async () => {
    const pet = sql(`select pet_id from pet_waivers where voided_at is null order by signed_at desc limit 1`)
    expect(pet, 'no signed waiver')
    await d.go('/pets/' + pet)
    await d.getByRole('button', { name: /^View$/ }).first().click(); await d.waitForTimeout(1000)
    const sig = await d.locator('img.waiver-signature').evaluate((i) => i.naturalWidth)
    expect(sig > 0, 'signature image blocked')
    await printed(d, () => d.getByRole('button', { name: /Print \/ save as PDF/ }).click())
  })
  await step(d, 'inpatient photos load', async () => {
    const pet = sql(`select s.pet_id from inpatient_updates u join inpatient_stays s on s.id = u.stay_id join pets p on p.id = s.pet_id where cardinality(u.media) > 0 and s.discharged_at is null and p.deleted_at is null order by u.created_at desc limit 1`)
    if (!pet) return 'no open stay with a photo: skipped'
    await d.go('/pets/' + pet); await d.waitForTimeout(1500)
    const widths = await d.locator('main img, #main-content img').evaluateAll((all) => all.map((i) => i.naturalWidth))
    expect(widths.some((w) => w > 0) && !widths.includes(0), 'an image failed: ' + widths.join(','))
  })

  const a = await login(browser, 'staging.admin', PASS.admin, 'en')
  await step(a, 'admin: every screen', async () => {
    for (const route of ADMIN_ROUTES) { await a.go(route) }
  })
  await step(m, 'fonts load (Google Fonts allowed)', async () => {
    const ok = await m.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "IBM Plex Sans"') })
    expect(ok, 'IBM Plex Sans did not load')
  })

  await browser.close()
  if (blocked.length) { failed++; console.log('FAIL blocked by the policy:'); for (const b of [...new Set(blocked)].slice(0, 20)) console.log('  ', b) } else console.log('ok nothing blocked by the policy')
  console.log(failed ? `${failed} FAILED` : 'all passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
