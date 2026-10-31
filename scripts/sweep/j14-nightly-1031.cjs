// Sweep script (10-31 nightly fixes; see README.md). Staging only. Saves data on the demo clinic (reset after v2).
// Pet picker: Enter before the results never picks a stale pet; a single match is picked once it arrives (B31) ->
// "Searching…", "No pets match" + Register new pet with the text filled in, "Couldn't search" (H44, B32) -> words in any
// order (H45) -> microchip already on another pet warns (H46) -> phone top-bar search (H47) -> lock screen shows when
// the desk was last used (H48) -> a reprint keeps the VAT number it was issued with (B30) -> visit autosave retries
// when the connection comes back (offline research).
// Run against a local build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j14-nightly-1031.cjs
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const PET = '30359b93-8e11-481b-988c-e84be20ff062' // Sunny, Waleed Al-Asiri
const CLINIC = 'Al Nakheel Veterinary Clinic'
const RUN = Date.now().toString().slice(-5)
const REASON = 'Sweep 1031 ' + RUN
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
let failed = 0

async function login(browser, user, pass, { w = 1180, h = 820, branch = 'Al Olaya' } = {}) {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: w, height: h }, hasTouch: w < 1000 })
  await ctx.addInitScript(() => { localStorage.setItem('touq-language', 'en'); localStorage.setItem('touq-theme', 'light') })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  await page.goto(SITE)
  await page.fill('input[autocomplete=username]', user)
  await page.fill('input[type=password]', pass)
  await page.click('form.login-form button[type=submit]')
  await page.waitForTimeout(4000)
  const pick = page.locator('.branch-picker-list button', { hasText: branch }).first()
  if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500) }
  return page
}
async function step(page, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 200))
    await page.screenshot({ path: out + `j14-fail-${name.replace(/\W+/g, '-').slice(0, 60)}.png`, fullPage: true })
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg) }
async function printed(page, click) {
  await page.context().addInitScript(() => { window.print = () => {} })
  const [popup] = await Promise.all([page.waitForEvent('popup'), click()])
  await popup.waitForLoadState()
  const html = (await popup.content()).split('<body')[1] ?? ''
  await popup.close()
  return html
}
async function openBooking(r) {
  await r.goto(SITE + '/appointments'); await r.waitForTimeout(3000)
  await r.getByRole('button', { name: /New appointment/ }).click()
  const box = r.locator('input[role=combobox]')
  await box.click(); await r.waitForTimeout(1000)
  return box
}
async function closeBooking(r) {
  await r.keyboard.press('Escape'); await r.waitForTimeout(500)
  const c = r.getByRole('alertdialog')
  if (await c.count()) await c.getByRole('button').last().click()
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const r = await login(browser, 'amal.desk', PASS.demoStaff)

  await step(r, 'B31: Enter right after typing waits, then picks the single match', async () => {
    const box = await openBooking(r)
    await box.pressSequentially('10026', { delay: 5 }); await box.press('Enter') // like a scanner: no pause before Enter
    await r.waitForTimeout(2000)
    expect((await box.inputValue()).startsWith('Sukkar'), 'scanner-style Enter did not pick Sukkar: ' + (await box.inputValue()))
    await closeBooking(r)
  })
  await step(r, 'B31: Enter on a text with several matches picks nothing by itself', async () => {
    const box = await openBooking(r)
    await box.pressSequentially('a', { delay: 5 }); await box.press('Enter')
    await r.waitForTimeout(2000)
    expect((await box.inputValue()) === 'a', 'a stale or first pet was picked: ' + (await box.inputValue()))
    expect(await r.locator('.pet-picker-option').count(), 'the matches list did not open')
    await closeBooking(r)
  })
  await step(r, 'H44: Searching… then No pets match + Register new pet with the name filled in', async () => {
    const box = await openBooking(r)
    const name = 'Sweepnomatch' + RUN
    await box.fill(name)
    expect(await r.getByText('Searching…').count(), '"Searching…" not shown while waiting')
    await r.waitForTimeout(1500)
    expect(await r.getByText(`No pets match "${name}"`).count(), 'no-match text missing')
    await r.getByRole('link', { name: 'Register new pet' }).click()
    await r.waitForURL(/\/pets\/new/, { timeout: 5000 }); await r.waitForTimeout(1500)
    expect((await r.getByLabel(/^Name/).first().inputValue()) === name, 'name not filled in')
  })
  await step(r, 'H44: a phone with no match fills the owner phone', async () => {
    await r.goto(SITE + '/pets/new?phone=0559998887'); await r.waitForTimeout(2000)
    expect((await r.locator('.phone-input input').inputValue()).replace(/\D/g, '') === '559998887', 'phone not filled in')
  })
  await step(r, 'B32: a failed search says so instead of "no pets"', async () => {
    await r.route(/\/rest\/v1\/pets\?.*search_text/, (route) => route.abort())
    const box = await openBooking(r)
    // supabase-js retries a failed read 3 times (1 + 2 + 4 s) before it reports the error; "Searching…" until then.
    await box.fill('Sukkar'); await r.waitForTimeout(10000)
    const failedText = await r.getByText("Couldn't search. Check your connection and try again.").count()
    await r.unroute(/\/rest\/v1\/pets\?.*search_text/)
    expect(failedText, 'search failure not shown')
    expect((await r.getByText(/No pets match/).count()) === 0, 'failure shown as "no pets"')
    await closeBooking(r)
  })
  await step(r, 'H45: words in any order (pet + owner, owner + pet)', async () => {
    await r.goto(SITE + '/pets'); await r.waitForTimeout(3000)
    for (const q of ['Sukkar امل', 'امل Sukkar']) {
      await r.getByRole('searchbox').fill(q); await r.waitForTimeout(1500)
      expect((await r.locator('.pet-list-item', { hasText: 'Sukkar' }).count()) >= 1, `"${q}" did not find Sukkar`)
    }
  })
  await step(r, 'H46: a microchip already on another pet warns, with a link', async () => {
    const [chip, name] = sql(`select microchip || '|' || name from pets where microchip is not null and deleted_at is null and clinic_id = (select id from clinics where name = '${CLINIC}') limit 1`).split('|')
    expect(chip, 'no pet with a microchip to test with')
    await r.goto(SITE + '/pets/new'); await r.waitForTimeout(2000)
    await r.getByLabel(/^Microchip/).fill(chip); await r.waitForTimeout(1500)
    expect(await r.getByText(`This microchip is already on ${name}`).count(), 'no duplicate-microchip warning')
    expect(await r.getByRole('link', { name: 'Open that pet' }).count(), 'no link to the other pet')
  })
  await step(r, 'B30: a reprint keeps the VAT number the invoice was issued with', async () => {
    const inv = sql(`select i.id || '|' || i.vat_number from invoices i join clinics c on c.id = i.clinic_id where c.name = '${CLINIC}' and i.tax_phase = 'phase1' and i.vat_number is not null and i.branch_id = (select id from branches where clinic_id = c.id and is_main) order by i.created_at desc limit 1`)
    const [id, issued] = inv.split('|')
    expect(id, 'no phase-1 invoice to reprint')
    const current = sql(`select vat_number from clinics where name = '${CLINIC}'`)
    sql(`update clinics set vat_number = '399999999999993' where name = '${CLINIC}'`)
    try {
      await r.goto(SITE + '/payments?invoice=' + id); await r.waitForTimeout(3500)
      const html = await printed(r, () => r.locator('[role=dialog]').last().getByRole('button', { name: /^Print$/ }).first().click())
      expect(html.includes(issued) && !html.includes('399999999999993'), 'reprint took the clinic\'s new VAT number')
    } finally {
      sql(`update clinics set vat_number = '${current}' where name = '${CLINIC}'`)
    }
  })

  let APPT = null
  await step(r, 'reception books + arrives (for the offline autosave check)', async () => {
    await r.goto(SITE + '/appointments?pet=' + PET)
    await r.waitForSelector('[role=dialog] input[type=date]', { timeout: 8000 })
    const dlg = r.locator('[role=dialog]')
    await dlg.locator('input[type=date]').fill(today)
    await dlg.getByLabel('Hour').selectOption('11')
    await dlg.getByLabel('Minute').selectOption('45')
    await dlg.locator('select').nth(2).selectOption('PM')
    await dlg.getByLabel('Reason').fill(REASON)
    const doc = dlg.locator('select').last()
    await doc.selectOption(await doc.locator('option', { hasText: 'Khalid' }).first().getAttribute('value'))
    await dlg.locator('button[type=submit]').first().click(); await r.waitForTimeout(2500)
    const anyway = dlg.getByRole('button', { name: /Schedule anyway/ })
    if (await anyway.count()) { await anyway.click(); await r.waitForTimeout(2500) }
    const ack = dlg.getByRole('checkbox')
    if (await ack.count()) { await ack.first().check(); await dlg.locator('button[type=submit]').first().click(); await r.waitForTimeout(2500) }
    APPT = sql(`select id from appointments where reason = '${REASON}' order by created_at desc limit 1`)
    expect(APPT, 'appointment not saved')
    await r.goto(SITE + '/appointments?open=' + APPT); await r.waitForTimeout(3000)
    const confirm = r.getByRole('button', { name: /^Confirm$/ })
    if (await confirm.count()) { await confirm.first().click(); await r.waitForTimeout(1500); await r.goto(SITE + '/appointments?open=' + APPT); await r.waitForTimeout(3000) }
    await r.getByRole('button', { name: /^Arrived$/ }).first().click(); await r.waitForTimeout(2000)
  })

  const d = await login(browser, 'khalid.vet', PASS.demoStaff)
  await step(d, 'offline: autosave retries by itself when the connection comes back', async () => {
    expect(APPT, 'no appointment')
    await d.goto(SITE + '/appointments?open=' + APPT); await d.waitForTimeout(3000)
    await d.getByRole('button', { name: /Start session/ }).first().click()
    await d.waitForURL(/\/session/, { timeout: 8000 }); await d.waitForTimeout(3000)
    await d.context().setOffline(true)
    await d.getByLabel(/Presenting complaint/i).fill('Sweep offline ' + RUN)
    await d.waitForTimeout(8000) // autosave tries and fails while offline
    expect(sql(`select coalesce(presenting_complaint, '') from medical_records where appointment_id = '${APPT}'`) !== 'Sweep offline ' + RUN, 'saved while offline?')
    await d.context().setOffline(false)
    await d.waitForTimeout(9000) // no typing: only the online event can trigger the save
    expect(sql(`select presenting_complaint from medical_records where appointment_id = '${APPT}'`) === 'Sweep offline ' + RUN, 'not saved after the connection came back')
    await d.locator('form.session-form select').first().selectOption({ index: 1 })
    await d.getByLabel(/^Diagnosis/).fill('Sweep check')
    await d.getByLabel(/^Treatment/).fill('None')
    await d.getByRole('button', { name: /Finish session/ }).first().click(); await d.waitForTimeout(1500)
    const c = d.getByRole('alertdialog')
    if (await c.count()) await c.getByRole('button').last().click()
    await d.waitForTimeout(3000)
  })

  const p = await login(browser, 'amal.desk', PASS.demoStaff, { w: 390, h: 844 })
  await step(p, 'H47: phone top bar has a search button that opens the quick search', async () => {
    await p.goto(SITE + '/pets'); await p.waitForTimeout(3000)
    await p.locator('.app-topbar').getByRole('button', { name: 'Search' }).click(); await p.waitForTimeout(800)
    expect(await p.locator('.quick-search').count(), 'quick search did not open')
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(over <= 0, 'sideways scroll on the phone: ' + over)
    await p.screenshot({ path: out + 'j14-phone-search.png' })
  })
  await step(p, 'H48: the lock screen says when the desk was last used', async () => {
    await p.evaluate(() => localStorage.setItem('touq.locked', '1'))
    await p.reload(); await p.waitForTimeout(3000)
    expect(await p.locator('.lock-screen').count(), 'not locked')
    expect(/Last used at \d/.test(await p.locator('.lock-screen').innerText()), 'no "Last used at" line')
    await p.screenshot({ path: out + 'j14-lock.png' })
    await p.getByLabel(/Password/).fill(PASS.demoStaff)
    await p.getByRole('button', { name: 'Unlock' }).click(); await p.waitForTimeout(3000)
    expect((await p.locator('.lock-screen').count()) === 0, 'unlock failed')
  })

  await browser.close()
  console.log(failed ? `${failed} FAILED` : 'all passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
