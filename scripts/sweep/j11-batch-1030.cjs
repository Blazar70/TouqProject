// Sweep script (10-30; see README.md). Staging only. Saves data on the demo clinic (reset after v2).
// The 10-30 batch: admin sets Al Nakheel to "Not VAT-registered" -> manager sees it read-only, prices without VAT ->
// reception books + arrives -> doctor repeats the last prescription + quick-pick buttons, finishes -> reception bills:
// no VAT, plain "Invoice" print without QR -> admin back to phase 1: old invoice stays plain, a phase-1 invoice keeps
// VAT + QR -> doctor prints the prescription alone -> idle lock: wrong password refused, right one opens the same page.
// Run against a local build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j11-batch-1030.cjs
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const PET = '30359b93-8e11-481b-988c-e84be20ff062'
const RUN = Date.now().toString().slice(-5)
const REASON = 'Sweep 1030 ' + RUN
const CLINIC = 'Al Nakheel Veterinary Clinic'
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
let failed = 0

async function login(browser, user, pass, branch = 'Al Olaya') {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript(() => { localStorage.setItem('touq-language', 'en'); localStorage.setItem('touq-theme', 'light') })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  page.on('console', (m) => m.type() === 'error' && console.log('  console', m.text().slice(0, 140)))
  await page.goto(SITE)
  await page.fill('input[autocomplete=username]', user)
  await page.fill('input[type=password]', pass)
  await page.click('form.login-form button[type=submit]')
  await page.waitForTimeout(4000)
  await pickBranch(page, branch)
  return page
}
async function pickBranch(page, branch = 'Al Olaya') {
  const pick = page.locator('.branch-picker-list button', { hasText: branch }).first()
  if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500) }
}
async function step(page, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 200))
    await page.screenshot({ path: out + `j11-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true })
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg) }
// Clicks a print button and returns the print window's HTML (window.print is stubbed so nothing blocks).
async function printed(page, click) {
  await page.context().addInitScript(() => { window.print = () => {} })
  const [popup] = await Promise.all([page.waitForEvent('popup'), click()])
  await popup.waitForLoadState()
  const html = (await popup.content()).split('<body')[1] ?? '' // body only: the styles name .print-qr on every invoice
  await popup.close()
  return html
}
async function setTaxPhase(a, label) {
  await a.goto(SITE + '/clinics'); await a.waitForTimeout(3500)
  await a.getByRole('button', { name: new RegExp(CLINIC) }).first().click(); await a.waitForTimeout(800)
  await a.getByRole('button', { name: /^Edit$/ }).first().click(); await a.waitForTimeout(500)
  await a.getByLabel('Tax status').selectOption({ label })
  await a.getByRole('button', { name: /^Save$/ }).first().click(); await a.waitForTimeout(2500)
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const a = await login(browser, 'staging.admin', PASS.admin)
  let APPT = null
  let INV = null

  await step(a, 'admin: phase 1 without a VAT number is refused', async () => {
    await a.goto(SITE + '/clinics'); await a.waitForTimeout(3500)
    await a.getByRole('button', { name: new RegExp(CLINIC) }).first().click(); await a.waitForTimeout(800)
    await a.getByRole('button', { name: /^Edit$/ }).first().click(); await a.waitForTimeout(500)
    expect(await a.locator('option[value=phase2]:disabled').count(), 'phase 2 should be listed but disabled')
    const vat = a.getByLabel(/VAT registration number/)
    const before = await vat.inputValue()
    await vat.fill('')
    await a.getByRole('button', { name: /^Save$/ }).first().click(); await a.waitForTimeout(1500)
    expect(sql(`select vat_number from clinics where name = '${CLINIC}'`) === before, 'VAT number was cleared while in phase 1')
    await a.getByRole('button', { name: /^Cancel$/ }).first().click()
  })
  await step(a, 'admin sets Al Nakheel to Not VAT-registered', async () => {
    await setTaxPhase(a, 'Not VAT-registered')
    expect(sql(`select tax_phase from clinics where name = '${CLINIC}'`) === 'none', 'phase not saved')
  })

  const m = await login(browser, 'MohBaf@touq.app', PASS.cofounder)
  await step(m, 'manager: tax status read-only, prices without VAT', async () => {
    await m.goto(SITE + '/settings'); await m.waitForTimeout(3500)
    expect(await m.getByText('Not VAT-registered').count(), 'tax status not shown')
    expect((await m.getByRole('textbox', { name: /VAT registration number/ }).count()) === 0, 'manager can still type a VAT number')
    expect((await m.getByText('Price before VAT').count()) === 0, 'price list still shows VAT columns')
    await m.screenshot({ path: out + 'j11-settings-novat.png', fullPage: true })
  })

  const r = await login(browser, 'amal.desk', PASS.demoStaff)
  await step(r, 'reception books + arrives', async () => {
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
    await dlg.locator('button[type=submit]').first().click()
    await r.waitForTimeout(2500)
    const anyway = dlg.getByRole('button', { name: /Schedule anyway/ })
    if (await anyway.count()) { await anyway.click(); await r.waitForTimeout(2500) }
    const ack = dlg.getByRole('checkbox')
    if (await ack.count()) { await ack.first().check(); await dlg.locator('button[type=submit]').first().click(); await r.waitForTimeout(2500) }
    APPT = sql(`select id from appointments where reason = '${REASON}' order by created_at desc limit 1`)
    expect(APPT, 'appointment not saved')
    await r.goto(SITE + '/appointments?open=' + APPT); await r.waitForTimeout(3000)
    const confirm = r.getByRole('button', { name: /^Confirm$/ })
    if (await confirm.count()) { await confirm.first().click(); await r.waitForTimeout(1500); await r.goto(SITE + '/appointments?open=' + APPT); await r.waitForTimeout(3000) }
    await r.getByRole('button', { name: /^Arrived$/ }).first().click()
    await r.waitForTimeout(2000)
  })

  const d = await login(browser, 'khalid.vet', PASS.demoStaff)
  await step(d, 'doctor: repeat last prescription + quick-pick buttons', async () => {
    expect(APPT, 'no appointment')
    await d.goto(SITE + '/appointments?open=' + APPT); await d.waitForTimeout(3000)
    await d.getByRole('button', { name: /Start session/ }).first().click()
    await d.waitForURL(/\/session/, { timeout: 8000 }); await d.waitForTimeout(3000)
    await d.locator('form.session-form select').first().selectOption({ index: 1 })
    await d.getByLabel(/Presenting complaint/i).fill('Sweep: ear check again')
    await d.getByLabel(/^Diagnosis/).fill('Otitis externa, better')
    await d.getByLabel(/^Treatment/).fill('Continue drops')
    await d.getByRole('button', { name: 'Repeat last prescription' }).click()
    expect((await d.getByLabel('Medicine').first().inputValue()) !== '', 'repeat left no medicine')
    const line = d.locator('.prescription-line').first()
    await line.getByRole('button', { name: 'every 8 hours' }).click()
    await line.getByRole('button', { name: '5 days' }).click()
    expect((await line.getByLabel('How often').inputValue()) === 'every 8 hours', 'frequency chip did not fill')
    expect((await line.getByRole('button', { name: '5 days' }).getAttribute('aria-pressed')) === 'true', 'picked chip not shown as pressed')
    await d.screenshot({ path: out + 'j11-session-rx.png', fullPage: true })
    await d.getByRole('button', { name: /Finish session/ }).first().click()
    await d.waitForTimeout(1500)
    const c = d.getByRole('alertdialog')
    if (await c.count()) await c.getByRole('button').last().click()
    await d.waitForTimeout(3000)
    const rx = sql(`select prescription->0->>'frequency' || '/' || (prescription->0->>'duration') from medical_records where appointment_id = '${APPT}'`)
    expect(rx === 'every 8 hours/5 days', 'prescription not saved: ' + rx)
  })

  await step(r, 'reception bills it: no VAT, plain invoice, no QR', async () => {
    await r.goto(SITE + '/payments?bill=' + APPT); await r.waitForTimeout(3500); await pickBranch(r)
    const svc = r.getByRole('combobox', { name: 'Service' }).first()
    await svc.selectOption({ index: 1 })
    await r.waitForTimeout(500)
    expect((await r.locator('.invoice-sums dt', { hasText: /^VAT$/ }).count()) === 0, 'preview still shows a VAT row')
    await r.getByRole('button', { name: /Create invoice/ }).click(); await r.waitForTimeout(3500)
    INV = sql(`select id from invoices where appointment_id = '${APPT}'`)
    expect(INV, 'invoice not created')
    expect(sql(`select vat_total || '/' || tax_phase from invoices where id = '${INV}'`) === '0.00/none', 'invoice carries VAT')
    await r.goto(SITE + '/payments?invoice=' + INV); await r.waitForTimeout(3500); await pickBranch(r)
    const html = await printed(r, () => r.locator('[role=dialog]').last().getByRole('button', { name: /^Print$/ }).first().click())
    expect(html.includes('<bdi>Invoice</bdi>') && !html.includes('tax invoice'), 'print title is not a plain Invoice')
    expect(!html.includes('data-tlv') && !html.includes('VAT'), 'print still shows VAT or a QR')
  })

  await step(a, 'admin back to phase 1: old invoice stays plain, a phase-1 invoice keeps VAT + QR', async () => {
    await setTaxPhase(a, 'VAT-registered (ZATCA phase 1)')
    expect(sql(`select tax_phase from clinics where name = '${CLINIC}'`) === 'phase1', 'phase 1 not saved')
    await r.goto(SITE + '/payments?invoice=' + INV); await r.waitForTimeout(3500); await pickBranch(r)
    let html = await printed(r, () => r.locator('[role=dialog]').last().getByRole('button', { name: /^Print$/ }).first().click())
    expect(!html.includes('data-tlv'), 'the unregistered invoice gained a QR')
    const old = sql(`select i.id from invoices i join clinics c on c.id = i.clinic_id where c.name = '${CLINIC}' and i.tax_phase = 'phase1' and i.branch_id = (select id from branches where clinic_id = c.id and is_main) order by i.created_at desc limit 1`)
    await r.goto(SITE + '/payments?invoice=' + old); await r.waitForTimeout(3500); await pickBranch(r)
    html = await printed(r, () => r.locator('[role=dialog]').last().getByRole('button', { name: /^Print$/ }).first().click())
    expect(html.includes('Simplified tax invoice') && html.includes('data-tlv'), 'phase-1 invoice lost its tax title or QR')
  })

  await step(d, 'doctor prints the prescription alone', async () => {
    await d.goto(SITE + '/pets/' + PET); await d.waitForTimeout(3500)
    await d.locator('.record-accordion-header').first().click(); await d.waitForTimeout(800)
    const html = await printed(d, () => d.getByRole('button', { name: 'Print prescription' }).first().click())
    expect(html.includes('every 8 hours') && html.includes('5 days') && html.includes('Khalid'), 'prescription print is missing lines or the doctor')
  })

  await step(d, 'idle lock: wrong password refused, right one opens the same page', async () => {
    const url = d.url()
    await d.clock.install()
    await d.reload(); await d.waitForTimeout(4000)
    await d.clock.fastForward('09:30')
    await d.getByRole('alertdialog').filter({ hasText: /locks in/ }).waitFor({ timeout: 5000 })
    await d.clock.fastForward('01:00')
    const lock = d.getByRole('dialog', { name: 'Screen locked' })
    await lock.waitFor({ timeout: 5000 })
    expect(await d.evaluate(() => document.getElementById('root').hasAttribute('inert')), 'app behind the lock is still reachable')
    await d.screenshot({ path: out + 'j11-lock.png' })
    await lock.getByLabel('Password').fill('wrong-password')
    await lock.getByRole('button', { name: 'Unlock' }).click(); await d.waitForTimeout(2500)
    expect(await lock.getByRole('alert').count(), 'wrong password gave no error')
    await lock.getByLabel('Password').fill(PASS.demoStaff)
    await lock.getByRole('button', { name: 'Unlock' }).click(); await d.waitForTimeout(3000)
    expect((await lock.count()) === 0, 'still locked after the right password')
    expect(d.url() === url, 'unlock moved to another page')
    expect(!(await d.evaluate(() => document.getElementById('root').hasAttribute('inert'))), 'app still inert after unlock')
  })

  console.log(failed ? `${failed} FAILED` : 'all passed', '· appointment', APPT, '· invoice', INV)
  await browser.close()
})()
