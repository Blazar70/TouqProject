// Sweep script (saved 10-28; see README.md). Staging only.
// Journey 7 (demo clinic, saves): nurse adds a vaccine to Sunny, marks it given, undoes · reception registers a new pet ·
// manager voids the sweep waiver · manager exports an owner's data.
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const { execFileSync } = require('child_process')
const sql = (q) => execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().trim()
const PET_ID = '30359b93-8e11-481b-988c-e84be20ff062'
const PET = SITE + '/pets/' + PET_ID
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
async function login(b, user, pass, opts = {}) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: opts.vp || { width: 1180, height: 820 }, acceptDownloads: true })
  await ctx.addInitScript((l) => { localStorage.setItem('touq-language', l); localStorage.setItem('touq-theme', 'dark') }, opts.lang || 'en')
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  p.pick = async () => { const bp = p.locator('.branch-picker-list button', { hasText: /Al Olaya|العليا/ }).first(); if (await bp.count()) { await bp.click(); await p.waitForTimeout(2000) } }
  await p.goto(SITE); await p.fill('input[autocomplete=username]', user); await p.fill('input[type=password]', pass)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000); await p.pick()
  return p
}
async function step(p, name, fn) { try { await fn(); console.log('ok', name) } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 160)); await p.screenshot({ path: out + `j7-fail-${name.replace(/\W+/g, '-')}.png` }) } }
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  if (process.argv[2] !== 'rest') { const n = await login(b, 'huda.nurse', PASS.demoStaff)
  await step(n, 'nurse: add vaccine, mark given, undo (EN dark)', async () => {
    await n.goto(PET); await n.waitForTimeout(3500); await n.pick()
    await n.getByRole('button', { name: /\+ Add vaccine/ }).click(); await n.waitForTimeout(800)
    const f = n.locator('form').filter({ has: n.getByLabel('Vaccine') }).first()
    await f.getByLabel('Vaccine').selectOption({ index: 1 })
    await f.locator('input[type=date]').fill(today)
    await f.locator('button[type=submit]').click(); await n.waitForTimeout(3000)
    await n.getByRole('button', { name: 'Mark given' }).first().click(); await n.waitForTimeout(1200)
    const c = n.getByRole('alertdialog'); if (await c.count()) await c.getByRole('button').filter({ hasNotText: /^Cancel$/ }).last().click()
    await n.waitForTimeout(3000)
    console.log('  doses after mark:', sql(`select count(*) from vaccine_doses d join pet_vaccines v on v.id=d.pet_vaccine_id where v.pet_id='${PET_ID}'`))
    await n.getByRole('button', { name: 'Undo' }).first().click(); await n.waitForTimeout(1200)
    const c2 = n.getByRole('alertdialog'); if (await c2.count()) await c2.getByRole('button').filter({ hasNotText: /^Cancel$/ }).last().click()
    await n.waitForTimeout(3000)
    console.log('  doses after undo:', sql(`select count(*) from vaccine_doses d join pet_vaccines v on v.id=d.pet_vaccine_id where v.pet_id='${PET_ID}'`))
  })
  }
  const r = await login(b, 'amal.desk', PASS.demoStaff, { lang: 'ar', vp: { width: 820, height: 1180 } })
  await step(r, 'reception registers a new pet (AR dark tablet)', async () => {
    await r.goto(SITE + '/pets/new'); await r.waitForTimeout(3500); await r.pick()
    const f = r.locator('main form').first()
    const inputs = f.locator('input:not([type=file]):not([type=date]):not([type=email])')
    await inputs.nth(0).fill('Sweep Kitten')
    await f.locator('.species-select button').first().click(); await r.waitForTimeout(500)
    await r.getByRole('option').first().click()
    await r.waitForTimeout(500)
    const all = await f.locator('input:visible:not([type=file]):not([type=date]):not([type=email])').all()
    await all[all.length - 2].fill('سارة الاختبار') // owner name
    await all[all.length - 1].fill('٠٥٥٠٠٠٠٩٩٩٩') // owner phone, Arabic digits
    await r.waitForTimeout(800)
    await f.locator('button[type=submit]').click(); await r.waitForTimeout(4000)
    console.log('  url after save:', r.url().replace(SITE, ''))
    console.log('  saved:', sql(`select p.name, o.name, o.phone from pets p join owner_files o on o.id=p.owner_file_id where p.name='Sweep Kitten'`))
  })
  const m = await login(b, 'MohBaf@touq.app', PASS.cofounder)
  await step(m, 'manager voids the sweep waiver', async () => {
    await m.goto(PET); await m.waitForTimeout(3500); await m.pick()
    await m.getByRole('button', { name: 'View' }).first().click(); await m.waitForTimeout(1200)
    const dlg = m.locator('[role=dialog]').last()
    await dlg.getByLabel(/Reason for voiding/).fill('Sweep: test waiver')
    await dlg.getByRole('button', { name: 'Void this waiver' }).click(); await m.waitForTimeout(1200)
    const c = m.getByRole('alertdialog'); if (await c.count()) await c.getByRole('button').filter({ hasNotText: /^Cancel$/ }).last().click()
    await m.waitForTimeout(3000)
    console.log('  waivers voided on Sunny:', sql(`select count(*) from pet_waivers where pet_id='${PET_ID}' and voided_at is not null`))
  })
  await step(m, 'manager exports owner data', async () => {
    await m.goto(SITE + '/owners'); await m.waitForTimeout(3500); await m.pick()
    await m.locator('li.pet-list-item, .data-row').filter({ hasText: 'Waleed Al-Asiri' }).getByRole('button', { name: 'Open' }).first().click(); await m.waitForTimeout(2500)
    const [dl] = await Promise.all([m.waitForEvent('download', { timeout: 10000 }), m.getByRole('button', { name: 'Export owner data' }).click().then(() => m.waitForTimeout(2500)).then(() => m.getByRole('button', { name: 'Download data file' }).click())])
    const path = out + 'export-' + dl.suggestedFilename(); await dl.saveAs(path)
    const data = JSON.parse(require('fs').readFileSync(path, 'utf8'))
    console.log('  export file:', dl.suggestedFilename(), '| keys:', Object.keys(data).join(','), '| pets:', (data.pets || []).length)
  })
  await b.close()
})()
