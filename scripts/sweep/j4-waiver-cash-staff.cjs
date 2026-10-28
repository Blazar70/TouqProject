// Sweep script (saved 10-28; see README.md). Staging only.
// Journey 4 (demo clinic, saves): waiver signed on a touch tablet in the owner view (AR) · cash count · manager adds a staff member.
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const { execFileSync } = require('child_process')
const sql = (q) => execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().trim()
const PET = SITE + '/pets/30359b93-8e11-481b-988c-e84be20ff062'
async function login(b, user, pass, lang, touch) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: touch ? { width: 820, height: 1180 } : { width: 1280, height: 800 }, hasTouch: !!touch })
  await ctx.addInitScript((l) => { localStorage.setItem('touq-language', l) }, lang)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  p.pick = async () => { const bp = p.locator('.branch-picker-list button', { hasText: /Al Olaya|العليا/ }).first(); if (await bp.count()) { await bp.click(); await p.waitForTimeout(2000) } }
  await p.goto(SITE); await p.fill('input[autocomplete=username]', user); await p.fill('input[type=password]', pass)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000); await p.pick()
  return p
}
async function step(p, name, fn) { try { await fn(); console.log('ok', name) } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 160)); await p.screenshot({ path: out + `j4-fail-${name.replace(/\W+/g, '-')}.png` }) } }
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const r = await login(b, 'amal.desk', PASS.demoStaff, 'ar', true)
  if (process.argv[2] === 'cash') { await step(r, 'cash count (AR)', CASH); await b.close(); return }
  await step(r, 'waiver signed in owner view (AR tablet)', async () => {
    const before = +sql(`select count(*) from pet_waivers where pet_id='30359b93-8e11-481b-988c-e84be20ff062'`)
    await r.goto(PET); await r.waitForTimeout(3500); await r.pick()
    await r.getByRole('button', { name: 'اجمع توقيعًا' }).or(r.getByRole('button', { name: /توقيع/ })).first().click()
    await r.waitForTimeout(1200)
    const dlg = r.locator('[role=dialog]').last()
    await dlg.locator('select').first().selectOption({ index: 1 }).catch(() => {})
    await dlg.getByRole('button', { name: /المالك|owner/i }).first().click() // show to owner
    await r.waitForTimeout(1000)
    await r.screenshot({ path: out + 'j4-owner-view.png' })
    const name = dlg.locator('input:not([type=checkbox])').last()
    if (!(await name.inputValue())) await name.fill('وليد العسيري')
    await dlg.locator('input[type=checkbox]').last().check()
    const pad = await dlg.locator('canvas').boundingBox()
    await r.mouse.move(pad.x + 30, pad.y + pad.height / 2); await r.mouse.down()
    for (let i = 1; i <= 12; i++) await r.mouse.move(pad.x + 30 + i * 18, pad.y + pad.height / 2 + (i % 2 ? -18 : 18), { steps: 3 })
    await r.mouse.up(); await r.waitForTimeout(500)
    await dlg.locator('button[type=submit]').click(); await r.waitForTimeout(3500)
    const after = +sql(`select count(*) from pet_waivers where pet_id='30359b93-8e11-481b-988c-e84be20ff062'`)
    if (after !== before + 1) throw new Error(`waiver count ${before} -> ${after}`)
  })
  await step(r, 'cash count (AR)', CASH)
  async function CASH() {
    await r.goto(SITE + '/reports'); await r.waitForTimeout(3500); await r.pick()
    const input = r.locator('input[aria-label^="' + 'النقد' + '"], input[aria-label*="·"]').first()
    await input.fill('150')
    await input.locator('xpath=following::button[1]').click(); await r.waitForTimeout(3000)
    console.log('  saved count:', sql(`select counted from cash_counts where counted_by = (select id from profiles where full_name like 'Amal%') order by created_at desc limit 1`))
  }
  const m = await login(b, 'MohBaf@touq.app', PASS.cofounder, 'en', false)
  await step(m, 'manager adds a staff member', async () => {
    await m.goto(SITE + '/staff'); await m.waitForTimeout(3500); await m.pick()
    const f = m.locator('form').filter({ has: m.getByText('Add a staff member') }).first()
    const sect = (await f.count()) ? f : m.locator('main')
    await sect.getByLabel(/^Full name|^Name/).first().fill('Sweep Test Nurse')
    await sect.getByLabel(/^Username/).first().fill('sweep.nurse')
    await sect.getByLabel(/^Password/).first().fill(PASS.sweepNurse)
    await sect.getByLabel(/^Role/).first().selectOption('nurse')
    const branch = sect.getByLabel('Al Olaya').first(); if (await branch.count()) await branch.check()
    await sect.getByRole('button', { name: /Add staff member/ }).click(); await m.waitForTimeout(4000)
    console.log('  staff row:', sql(`select clinic_role, disabled from profiles where full_name = 'Sweep Test Nurse'`))
  })
  await b.close()
})()
