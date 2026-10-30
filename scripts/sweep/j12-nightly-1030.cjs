// Sweep script (10-30 nightly fixes; see README.md). Staging only. Saves data on the demo clinic (reset after v2).
// Server search (B29/H39): Arabic typed without hamza and a local phone find the pet and the owner; the booking and
// payment pickers find pets by search -> microchip (H42) saved, searchable, printed -> weight change in kg (H40) ->
// visit record saves by itself and says so, bad vitals say why (H41) -> admin import with a microchip; a re-run
// lists the rows left out (H43).
// Run against a local build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j12-nightly-1030.cjs
const fs = require('fs')
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const PET = '30359b93-8e11-481b-988c-e84be20ff062' // Sunny, Waleed Al-Asiri
const SUKKAR = '7b4fffe2-fa8d-4b73-a877-d389420a9a5e' // owner أمل التميمي, +966500001259, Pet ID 10026
const RUN = Date.now().toString().slice(-5)
const REASON = 'Sweep 1030b ' + RUN
const CHIP = '982000' + RUN + '0123'
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
  const pick = page.locator('.branch-picker-list button', { hasText: branch }).first()
  if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500) }
  return page
}
async function step(page, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 200))
    await page.screenshot({ path: out + `j12-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true })
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

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const r = await login(browser, 'amal.desk', PASS.demoStaff)

  await step(r, 'pets search: Arabic without hamza, local phone', async () => {
    await r.goto(SITE + '/pets'); await r.waitForTimeout(3000)
    await r.getByRole('searchbox').fill('امل التميمي'); await r.waitForTimeout(1500)
    expect(await r.locator(`#pet-row-${SUKKAR}`).count(), 'hamza-less owner name did not find Sukkar')
    await r.getByRole('searchbox').fill('0500001259'); await r.waitForTimeout(1500)
    expect((await r.locator('.pet-list-item').count()) === 1 && (await r.locator(`#pet-row-${SUKKAR}`).count()), 'local phone did not find exactly Sukkar')
  })
  await step(r, 'owners search on the server', async () => {
    await r.goto(SITE + '/owners'); await r.waitForTimeout(3000)
    await r.getByRole('searchbox').fill('امل التميمي'); await r.waitForTimeout(1500)
    expect((await r.locator('.pet-list-item').count()) === 1, 'owner search should show one owner')
  })
  await step(r, 'booking picker finds a pet by search', async () => {
    await r.goto(SITE + '/appointments'); await r.waitForTimeout(3000)
    await r.getByRole('button', { name: /New appointment/ }).click()
    const box = r.locator('input[role=combobox]')
    await box.click(); await r.waitForTimeout(1000)
    expect(await r.getByText('Newest pets — type to search all').count(), 'empty box should list the newest pets')
    await box.fill('10026'); await r.waitForTimeout(1200)
    await r.locator('.pet-picker-option').first().click(); await r.waitForTimeout(1200)
    expect((await box.inputValue()).startsWith('Sukkar'), 'picked pet not shown: ' + (await box.inputValue()))
    expect(await r.locator('[role=dialog]').getByText('أمل التميمي').count(), 'owner info under the picker missing')
    await r.keyboard.press('Escape'); await r.waitForTimeout(500)
    const c = r.getByRole('alertdialog')
    if (await c.count()) await c.getByRole('button').last().click()
  })
  await step(r, 'payments picker finds a pet by search', async () => {
    await r.goto(SITE + '/payments'); await r.waitForTimeout(3500)
    const box = r.locator('input[role=combobox]')
    await box.fill('امل'); await r.waitForTimeout(1200)
    await r.getByRole('option', { name: /Sukkar/ }).first().click(); await r.waitForTimeout(800)
    expect((await box.inputValue()).startsWith('Sukkar'), 'payments pet not picked')
  })

  // A booked + arrived visit for the autosave check.
  let APPT = null
  await step(r, 'reception books + arrives (for the autosave check)', async () => {
    await r.goto(SITE + '/appointments?pet=' + PET)
    await r.waitForSelector('[role=dialog] input[type=date]', { timeout: 8000 })
    const dlg = r.locator('[role=dialog]')
    await dlg.locator('input[type=date]').fill(today)
    await dlg.getByLabel('Hour').selectOption('11')
    await dlg.getByLabel('Minute').selectOption('30')
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
  await step(d, 'visit record saves by itself; bad vitals say why', async () => {
    expect(APPT, 'no appointment')
    await d.goto(SITE + '/appointments?open=' + APPT); await d.waitForTimeout(3000)
    await d.getByRole('button', { name: /Start session/ }).first().click()
    await d.waitForURL(/\/session/, { timeout: 8000 }); await d.waitForTimeout(3000)
    await d.getByLabel(/Presenting complaint/i).fill('Sweep autosave ' + RUN)
    await d.waitForTimeout(8000)
    const status = d.locator('.autosave-status')
    expect(/^Saved /.test(await status.innerText()), 'no "Saved" status: ' + (await status.innerText()))
    expect(sql(`select presenting_complaint from medical_records where appointment_id = '${APPT}'`) === 'Sweep autosave ' + RUN, 'complaint not saved by itself')
    await d.getByLabel(/Temperature/).fill('3x')
    await d.waitForTimeout(800)
    expect((await status.innerText()).startsWith('Not saved yet: Temperature'), 'bad vitals not explained: ' + (await status.innerText()))
    await d.getByLabel(/Temperature/).fill('38.5'); await d.waitForTimeout(8000)
    expect(sql(`select temperature_c from medical_records where appointment_id = '${APPT}'`) === '38.5', 'fixed temperature not saved by itself')
    await d.locator('form.session-form select').first().selectOption({ index: 1 })
    await d.getByLabel(/^Diagnosis/).fill('Sweep check')
    await d.getByLabel(/^Treatment/).fill('None')
    await d.getByRole('button', { name: /Finish session/ }).first().click(); await d.waitForTimeout(1500)
    const c = d.getByRole('alertdialog')
    if (await c.count()) await c.getByRole('button').last().click()
    await d.waitForTimeout(3000)
  })
  await step(d, 'microchip: saved, shown, searchable, printed', async () => {
    await d.goto(SITE + '/pets/' + PET); await d.waitForTimeout(3500)
    await d.locator('section', { has: d.getByRole('heading', { name: 'Pet details' }) }).getByRole('button', { name: /^Edit$/ }).click()
    await d.getByLabel(/^Microchip/).fill(CHIP.slice(0, 3) + ' ' + CHIP.slice(3))
    await d.getByRole('button', { name: 'Save changes' }).click(); await d.waitForTimeout(2500)
    expect(sql(`select microchip from pets where id = '${PET}'`) === CHIP, 'microchip not saved')
    expect(await d.getByText(CHIP).count(), 'microchip not shown on the pet file')
    expect(await d.getByText(/since the last weighing/).count() === 0 || (await d.getByText(/kg \([+−]?\d+%\) since the last weighing/).count()), 'weight change not shown in kg and %')
    const html = await printed(d, () => d.getByRole('button', { name: 'Print full history' }).click())
    expect(html.includes(CHIP), 'microchip not on the print')
    await d.goto(SITE + '/pets'); await d.waitForTimeout(3000)
    await d.getByRole('searchbox').fill(CHIP.slice(-9)); await d.waitForTimeout(1500)
    expect((await d.locator('.pet-list-item').count()) === 1 && (await d.locator(`#pet-row-${PET}`).count()), 'microchip search did not find Sunny')
  })

  const a = await login(browser, 'staging.admin', PASS.admin)
  const file = out + 'j12-import.csv'
  fs.writeFileSync(file, `﻿owner_name,owner_phone,pet_name,species,microchip\r\nSweep Chip Owner ${RUN},0558${RUN}0,Sweep Chip Cat ${RUN},cat,${CHIP.slice(0, -1)}9\r\n`)
  await step(a, 'import with a microchip; a re-run lists the rows left out', async () => {
    const open = async () => {
      await a.goto(SITE + '/clinics'); await a.waitForTimeout(3500)
      await a.locator('.record-accordion-header', { has: a.locator('strong', { hasText: /^Clinic A$/ }) }).click(); await a.waitForTimeout(1500)
      await a.getByRole('button', { name: 'Import owners & pets' }).click()
      await a.getByRole('dialog').locator('input[type=file]').setInputFiles(file); await a.waitForTimeout(1000)
      await a.getByRole('dialog').getByRole('button', { name: 'Import' }).click(); await a.waitForTimeout(3000)
    }
    await open()
    expect(sql(`select microchip from pets where name = 'Sweep Chip Cat ${RUN}'`) === CHIP.slice(0, -1) + '9', 'imported microchip missing')
    await open()
    const dlg = a.getByRole('dialog')
    expect(await dlg.getByText(/1 rows were left out/).count(), 'left-out rows not explained')
    const [download] = await Promise.all([a.waitForEvent('download'), dlg.getByRole('button', { name: /Download the rows left out/ }).click()])
    const csv = fs.readFileSync(await download.path(), 'utf8')
    expect(csv.includes(`Sweep Chip Cat ${RUN}`), 'downloaded CSV lacks the left-out row')
    await dlg.screenshot({ path: out + 'j12-import-skipped.png' })
  })

  console.log(failed ? `${failed} FAILED` : 'all passed')
  await browser.close()
  process.exit(failed ? 1 : 0)
})()
