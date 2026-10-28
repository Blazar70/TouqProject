// Sweep item 3: the handoff §5 "untested" list. Usage: node scripts/sweep/untested.cjs [checkName ...]
// Saves only on sweep test records (Sweep Kitten, Sweep template, Sweep time off) or reverts itself.
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const { text } = require('./i18n.cjs')
const { execFileSync } = require('child_process')
const sql = (q) => execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().trim()
const CLINIC = `(select id from clinics where name like 'Al Nakheel%')`
const KITTEN = sql(`select id from pets where name = 'Sweep Kitten' and clinic_id = ${CLINIC}`)
const riyadh = (ms = Date.now()) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Riyadh' }) // "2026-10-28 13:05:00"
const only = process.argv.slice(2)

async function login(b, user, pass, { lang = 'en', tz = 'Asia/Riyadh', vp = { width: 1280, height: 800 } } = {}) {
  const ctx = await b.newContext({ timezoneId: tz, viewport: vp })
  await ctx.addInitScript((l) => localStorage.setItem('touq-language', l), lang)
  const p = await ctx.newPage()
  p.errors = []
  p.on('pageerror', (e) => p.errors.push(e.message.slice(0, 120)))
  p.pick = async () => { const bp = p.locator('.branch-picker-list button').filter({ hasText: /Al Olaya|العليا/ }).first(); if (await bp.count()) { await bp.click(); await p.waitForTimeout(2000) } }
  p.go = async (path) => { await p.goto(SITE + path); await p.waitForTimeout(3500); await p.pick() }
  await p.goto(SITE); await p.fill('input[autocomplete=username]', user); await p.fill('input[type=password]', pass)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000); await p.pick()
  return p
}
const accept = async (p) => { const c = p.getByRole('alertdialog'); if (await c.count()) await c.getByRole('button').filter({ hasNotText: /^(Cancel|إلغاء)$/ }).last().click() }
const results = []
async function check(name, page, fn) {
  if (only.length && !only.includes(name)) return
  try { const note = await fn(); results.push(`ok   ${name}${note ? ' — ' + note : ''}`) } catch (e) {
    results.push(`FAIL ${name} — ${e.message.split('\n')[0].slice(0, 170)}`)
    await page.screenshot({ path: out + `untested-${name}.png`, fullPage: true }).catch(() => {})
  }
  if (page.errors.length) { results.push(`  ! page errors in ${name}: ${page.errors.join(' | ')}`); page.errors = [] }
}

;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const nurse = await login(b, 'huda.nurse', PASS.demoStaff)
  await check('nurse-edit-pet', nurse, async () => {
    await nurse.go('/pets/' + KITTEN)
    await nurse.getByRole('button', { name: /^Edit$/ }).last().click(); await nurse.waitForTimeout(800)
    await nurse.getByLabel(/^Breed/).fill('Sweep breed')
    await nurse.getByRole('button', { name: /^Save changes$/ }).click(); await nurse.waitForTimeout(2500)
    const breed = sql(`select breed from pets where id='${KITTEN}'`)
    if (breed !== 'Sweep breed') throw new Error('breed is ' + breed)
  })
  await check('photo-upload', nurse, async () => {
    await nurse.go('/pets/' + KITTEN)
    // 1x1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await nurse.getByRole('button', { name: /^Edit$/ }).last().click(); await nurse.waitForTimeout(800)
    await nurse.locator('form input[type=file][accept^="image"]').first().setInputFiles({ name: 'sweep.png', mimeType: 'image/png', buffer: png })
    await nurse.waitForTimeout(4000)
    const photo = sql(`select photo_url is not null from pets where id='${KITTEN}'`)
    if (photo !== 't') throw new Error('no photo saved')
  })

  const doc = await login(b, 'khalid.vet', PASS.demoStaff, { lang: 'ar' })
  await check('ar-week-view', doc, async () => {
    await doc.go('/appointments')
    await doc.getByRole('button', { name: text('ar', 'calendar.week') }).click(); await doc.waitForTimeout(3000)
    const r = await doc.evaluate(() => ({
      events: document.querySelectorAll('.rbc-event').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      english: [...document.querySelectorAll('.rbc-toolbar, .rbc-time-header, .rbc-time-gutter')].map((e) => e.innerText).join(' ').match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|AM|PM|Week|Day|Today)\b/g),
    }))
    if (!r.events || r.overflow > 0 || r.english) throw new Error(JSON.stringify(r))
    return `${r.events} hour boxes, no English, no overflow`
  })

  const desk = await login(b, 'amal.desk', PASS.demoStaff)
  await check('b9-arrived-only-today', desk, async () => {
    const future = sql(`select id from appointments where clinic_id=${CLINIC} and status='confirmed' and scheduled_at > (now() at time zone 'Asia/Riyadh')::date + 1 - interval '3 hours' order by scheduled_at limit 1`)
    if (!future) return 'skipped: no confirmed appointment after today'
    await desk.go('/appointments?open=' + future)
    const arrived = await desk.getByRole('button', { name: /^Arrived$/ }).count()
    if (arrived) throw new Error('Arrived offered on a future appointment ' + future)
    return 'no Arrived button on a future confirmed appointment'
  })
  await check('undo-by-keyboard', desk, async () => {
    const today = sql(`select id from appointments where clinic_id=${CLINIC} and status='confirmed' and (scheduled_at at time zone 'Asia/Riyadh')::date = (now() at time zone 'Asia/Riyadh')::date and branch_id=(select id from branches where clinic_id=${CLINIC} and is_main) limit 1`)
    if (!today) return 'skipped: no confirmed appointment today at Al Olaya'
    await desk.go('/appointments?open=' + today)
    await desk.getByRole('button', { name: /^Arrived$/ }).click(); await desk.waitForTimeout(1200)
    let reached = false
    for (let i = 0; i < 40 && !reached; i++) {
      await desk.keyboard.press('Tab')
      reached = await desk.evaluate(() => /^(Undo|تراجع)$/.test(document.activeElement?.innerText?.trim() ?? ''))
    }
    if (!reached) { sql(`update appointments set status='confirmed', arrived_at=null where id='${today}'`); throw new Error('Undo not reachable with Tab (reverted by SQL)') }
    await desk.keyboard.press('Enter'); await desk.waitForTimeout(2500)
    const st = sql(`select status from appointments where id='${today}'`)
    if (st !== 'confirmed') throw new Error('status after keyboard Undo: ' + st)
    return 'Tab reaches the toast Undo, Enter undoes the check-in'
  })
  await check('cash-count-per-branch', desk, async () => {
    await desk.go('/reports')
    const n = await desk.locator('input[aria-label*="·"]').count()
    return `receptionist sees ${n} branch count field(s)`
  })
  await check('dashboard-auto-reload', desk, async () => {
    await desk.go('/')
    let calls = 0
    const onReq = (r) => { if (r.url().includes('/rest/v1/appointments')) calls++ }
    desk.on('request', onReq)
    await desk.waitForTimeout(128000)
    desk.off('request', onReq)
    if (!calls) throw new Error('no reload within 128 s')
    return `${calls} appointment request(s) in 128 s without touching the page`
  })

  const tokyo = await login(b, 'amal.desk', PASS.demoStaff, { tz: 'Asia/Tokyo' })
  await check('book-from-tokyo-device', tokyo, async () => {
    const reason = 'Sweep tokyo ' + Date.now().toString().slice(-5)
    const tomorrow = riyadh(Date.now() + 86400000).slice(0, 10)
    await tokyo.go('/appointments?pet=' + KITTEN)
    const d = tokyo.locator('[role=dialog]')
    await d.locator('input[type=date]').fill(tomorrow)
    await d.getByLabel('Hour').selectOption('10'); await d.getByLabel('Minute').selectOption('00'); await d.locator('select').nth(2).selectOption('AM')
    await d.getByLabel('Reason').fill(reason)
    const doc2 = d.locator('select').last(); await doc2.selectOption(await doc2.locator('option', { hasText: 'Khalid' }).first().getAttribute('value'))
    await d.locator('button[type=submit]').first().click(); await tokyo.waitForTimeout(2500)
    const anyway = d.getByRole('button', { name: /Schedule anyway/ }); if (await anyway.count()) { await anyway.click(); await tokyo.waitForTimeout(2500) }
    const saved = sql(`select id, to_char(scheduled_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') from appointments where reason='${reason}'`)
    const [id, at] = saved.split('|')
    sql(`update appointments set status='cancelled', cancellation_category='other', cancellation_reason='Sweep cleanup' where id='${id}'`)
    if (at !== `${tomorrow} 10:00`) throw new Error('saved as ' + at + ' Riyadh')
    return `saved ${at} Riyadh time from a Tokyo device (then cancelled)`
  })

  const mgr = await login(b, 'MohBaf@touq.app', PASS.cofounder, { tz: 'Asia/Tokyo' })
  await check('b11-paid-at-clinic-time', mgr, async () => {
    const inv = sql(`select id from invoices where clinic_id=${CLINIC} and payment_status in ('unpaid','partial') order by created_at limit 1`)
    if (!inv) return 'skipped: no unpaid invoice'
    await mgr.go('/payments?invoice=' + inv)
    await mgr.locator('[role=dialog]').last().getByRole('button', { name: /^Add payment$/ }).first().click(); await mgr.waitForTimeout(1000)
    const form = mgr.locator('form.invoice-action-form')
    await form.getByRole('button', { name: /Enter an earlier time/ }).click(); await mgr.waitForTimeout(500)
    const field = form.locator('input[type=datetime-local]')
    const value = await field.inputValue(), max = await field.getAttribute('max')
    const now = riyadh().slice(0, 16).replace(' ', 'T')
    const off = (v) => Math.abs((new Date(v + ':00+03:00') - new Date(now + ':00+03:00')) / 60000)
    if (off(value) > 3 || off(max) > 3) throw new Error(`value ${value}, max ${max}, Riyadh now ${now}`)
    const before = sql(`select count(*) from invoice_payments where invoice_id='${inv}'`)
    await field.fill(riyadh(Date.now() + 2 * 3600000).slice(0, 16).replace(' ', 'T'))
    await form.locator('input[type=number]').fill('0.01')
    await form.locator('button[type=submit]').click(); await mgr.waitForTimeout(2500)
    const blocked = await field.evaluate((el) => !el.checkValidity())
    const after = sql(`select count(*) from invoice_payments where invoice_id='${inv}'`)
    if (after !== before) throw new Error('future payment SAVED')
    return `on a Tokyo device the time and its maximum are Riyadh now (${value}); a future time is blocked by the form (${blocked}), nothing saved`
  })
  await check('deposit-receipt', mgr, async () => {
    await mgr.go('/owners')
    await mgr.locator('li.pet-list-item, .data-row').filter({ hasText: 'Waleed Al-Asiri' }).getByRole('button', { name: /^Open$/ }).first().click(); await mgr.waitForTimeout(2500)
    await mgr.getByRole('button', { name: /^Add balance$/ }).first().click(); await mgr.waitForTimeout(800)
    const dlg = mgr.locator('[role=dialog]').last()
    await dlg.locator('input[type=number], input[inputmode=decimal]').first().fill('5')
    const before = sql(`select count(*) from owner_balance_entries where kind='top_up' and clinic_id=${CLINIC}`)
    await dlg.locator('button[type=submit]').first().click(); await mgr.waitForTimeout(3000)
    if (sql(`select count(*) from owner_balance_entries where kind='top_up' and clinic_id=${CLINIC}`) === before) throw new Error('top-up not saved')
    await mgr.keyboard.press('Escape'); await mgr.waitForTimeout(800)
    const [pw] = await Promise.all([mgr.waitForEvent('popup', { timeout: 8000 }), mgr.getByRole('button', { name: /Print receipt/ }).first().click()])
    await pw.waitForTimeout(1500)
    const html = await pw.content(); await pw.close()
    const dep = (html.match(/DEP-[A-Z]+-\d+/) || [])[0]
    if (!dep) throw new Error('no DEP- number on the receipt')
    return `${dep} printed, Arabic + English labels: ${html.includes('bi-ar')}`
  })
  await check('cash-count-manager-branches', mgr, async () => {
    await mgr.go('/reports')
    const n = await mgr.locator('input[aria-label*="·"]').count()
    if (n < 2) throw new Error(`whole-clinic manager sees ${n} branch field(s), expected 2`)
    return `whole-clinic manager sees ${n} branch count fields`
  })
  await check('waiver-templates', mgr, async () => {
    await mgr.go('/settings')
    await mgr.getByRole('button', { name: /New waiver text/ }).click(); await mgr.waitForTimeout(800)
    const form = mgr.locator('form').filter({ has: mgr.locator('textarea') }).last()
    for (const i of await form.locator('input:not([type=checkbox]):not([type=radio])').all()) await i.fill('Sweep template')
    for (const t of await form.locator('textarea').all()) await t.fill('Sweep: test text, safe to delete.')
    await form.locator('button[type=submit]').click(); await mgr.waitForTimeout(3000)
    const id = sql(`select id from waiver_templates where title_en='Sweep template' order by created_at desc limit 1`)
    if (!id) throw new Error('template not saved')
    const row = mgr.locator('li, .record-row').filter({ hasText: 'Sweep template' }).last()
    await row.getByRole('button', { name: /^Archive$/ }).click(); await mgr.waitForTimeout(1000); await accept(mgr); await mgr.waitForTimeout(2500)
    const archived = sql(`select not active from waiver_templates where id='${id}'`)
    await mgr.locator('li, .record-row').filter({ hasText: 'Sweep template' }).last().getByRole('button', { name: /^Restore$/ }).click(); await mgr.waitForTimeout(2500)
    const restored = sql(`select active from waiver_templates where id='${id}'`)
    if (archived !== 't' || restored !== 't') throw new Error(`archived ${archived}, restored ${restored}`)
    return 'created, archived, restored'
  })
  await check('time-off-lines', mgr, async () => {
    await mgr.go('/staff')
    const row = mgr.locator('li.pet-list-item').filter({ hasText: 'Khalid' })
    await row.getByRole('button', { name: /^Time off$/ }).click(); await mgr.waitForTimeout(1200)
    const day = riyadh(Date.now() + 9 * 86400000).slice(0, 10)
    const panel = mgr.locator('.time-off-panel').first()
    const dates = panel.locator('input[type=date]'), times = panel.locator('input[type=time]')
    await dates.nth(0).fill(day); await times.nth(0).fill('09:00'); await dates.nth(1).fill(day); await times.nth(1).fill('11:00')
    await panel.getByLabel(/Reason/).fill('Sweep time off')
    await panel.locator('button[type=submit]').click(); await mgr.waitForTimeout(3000)
    const id = sql(`select id from doctor_time_off where reason='Sweep time off' order by created_at desc limit 1`)
    if (!id) throw new Error('time off not saved')
    const line = (await panel.innerText()).replace(/\s+/g, ' ')
    sql(`delete from doctor_time_off where id='${id}'`)
    return 'saved and listed: "' + (line.match(/\d{1,2}:\d{2}[^·]{0,40}/) || [''])[0].trim() + '" (then deleted)'
  })

  const ar = await (async () => { const ctx = await b.newContext(); await ctx.addInitScript(() => localStorage.setItem('touq-language', 'ar')); const p = await ctx.newPage(); p.errors = []; return p })()
  await check('arabic-error-texts', ar, async () => {
    await ar.goto(SITE); await ar.fill('input[autocomplete=username]', 'amal.desk'); await ar.fill('input[type=password]', 'wrong-password-sweep')
    await ar.click('form.login-form button[type=submit]'); await ar.waitForTimeout(3000)
    const loginMsg = (await ar.locator('[role=alert]').allInnerTexts()).join(' ')
    await ar.getByRole('button', { name: text('ar', 'auth.forgotPassword') }).click(); await ar.waitForTimeout(500)
    await ar.locator('input[type=email]').fill('sweep-check@example.com')
    await ar.getByRole('button', { name: text('ar', 'auth.sendResetLink') }).click(); await ar.waitForTimeout(4000)
    const resetMsg = (await ar.locator('form.login-form [role=alert]').allInnerTexts()).join(' ') || (await ar.locator('.toast, [role=status]').allInnerTexts()).join(' ')
    const latin = /[A-Za-z]{4,}/
    if (latin.test(loginMsg) || !loginMsg) throw new Error(`login message: "${loginMsg}"`)
    return `wrong password: "${loginMsg.slice(0, 50)}" | reset: "${resetMsg.slice(0, 60)}"${latin.test(resetMsg) ? ' (HAS ENGLISH)' : ''}`
  })

  await b.close()
  console.log(results.join('\n'))
})()
