// Sweep item 4 (saves, test records only): owner merge + move a pet · branch-manager saves · admin test clinic
// create → disable → enable → trash → purge. Usage: node scripts/sweep/item4.cjs [checkName ...]
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const { execFileSync } = require('child_process')
// First line only, without the Windows "\r" psql adds (an INSERT … RETURNING also prints "INSERT 0 1").
const sql = (q) => execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().trim().split(/\r?\n/)[0].trim()
const CLINIC = `(select id from clinics where name like 'Al Nakheel%')`
const only = process.argv.slice(2)
const stamp = Date.now().toString().slice(-5)

async function login(b, user, pass) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('touq-language', 'en'))
  const p = await ctx.newPage()
  p.errors = []
  p.on('pageerror', (e) => p.errors.push(e.message.slice(0, 120)))
  p.pick = async () => { const bp = p.locator('.branch-picker-list button').first(); if (await bp.count()) { await bp.click(); await p.waitForTimeout(2000) } }
  p.go = async (path) => { await p.goto(SITE + path); await p.waitForTimeout(3500); await p.pick() }
  await p.goto(SITE); await p.fill('input[autocomplete=username]', user); await p.fill('input[type=password]', pass)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000); await p.pick()
  return p
}
// Accept a confirm ONLY if it names what we expect (the 10-28 lesson).
async function acceptNaming(p, expected) {
  const c = p.getByRole('alertdialog')
  if (!(await c.count())) return
  const t = await c.innerText()
  if (!t.includes(expected)) { await c.getByRole('button', { name: /^Cancel$/ }).click(); throw new Error(`confirm did not name "${expected}": ${t.slice(0, 90)}`) }
  await c.getByRole('button').filter({ hasNotText: /^Cancel$/ }).last().click()
}
const results = []
async function check(name, page, fn) {
  if (only.length && !only.includes(name)) return
  try { const note = await fn(); results.push(`ok   ${name}${note ? ' — ' + note : ''}`) } catch (e) {
    results.push(`FAIL ${name} — ${e.message.split('\n')[0].slice(0, 170)}`)
    await page.screenshot({ path: out + `item4-${name}.png`, fullPage: true }).catch(() => {})
  }
  if (page.errors.length) { results.push(`  ! page errors in ${name}: ${page.errors.join(' | ')}`); page.errors = [] }
}

;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const mgr = await login(b, 'MohBaf@touq.app', PASS.cofounder)
  await check('owner-merge', mgr, async () => {
    const A = `Sweep Owner A ${stamp}`, B = `Sweep Owner B ${stamp}`
    const idA = sql(`insert into owner_files (clinic_id, name, phone) values (${CLINIC}, '${A}', '+96650000${stamp.slice(0, 4)}') returning id`).split('\n')[0]
    const idB = sql(`insert into owner_files (clinic_id, name, phone) values (${CLINIC}, '${B}', '+96650001${stamp.slice(0, 4)}') returning id`).split('\n')[0]
    await mgr.go('/owners')
    await mgr.locator('li.pet-list-item, .data-row').filter({ hasText: A }).getByRole('button', { name: /^Open$/ }).first().click(); await mgr.waitForTimeout(2500)
    await mgr.getByRole('button', { name: /^Merge$/ }).first().click(); await mgr.waitForTimeout(800)
    const picker = mgr.locator('[role=dialog]').last()
    await picker.getByLabel(/Search/).fill(B); await mgr.waitForTimeout(1500)
    await picker.locator('button.owner-pick-row').filter({ hasText: B }).first().click(); await mgr.waitForTimeout(1000)
    await acceptNaming(mgr, B); await mgr.waitForTimeout(3000)
    const left = sql(`select count(*) from owner_files where id='${idB}'`)
    if (left !== '0') throw new Error('owner B still exists after merge')
    return `merged "${B}" into "${A}" (B removed)`
  })
  await check('move-pet', mgr, async () => {
    const A = sql(`select name from owner_files where name like 'Sweep Owner A ${stamp}'`)
    const kitten = sql(`select id from pets where name='Sweep Kitten' and clinic_id=${CLINIC}`)
    await mgr.go('/pets/' + kitten)
    await mgr.getByRole('button', { name: /^Change owner$/ }).click(); await mgr.waitForTimeout(800)
    const picker = mgr.locator('[role=dialog]').last()
    await picker.getByLabel(/Search/).fill(A); await mgr.waitForTimeout(1500)
    await picker.locator('button.owner-pick-row').filter({ hasText: A }).first().click(); await mgr.waitForTimeout(1000)
    await acceptNaming(mgr, 'Sweep Kitten'); await mgr.waitForTimeout(3000)
    const now = sql(`select o.name from pets p join owner_files o on o.id=p.owner_file_id where p.id='${kitten}'`)
    if (now !== A) throw new Error('kitten owner is ' + now)
    return `Sweep Kitten moved to "${A}"`
  })

  const bm = await login(b, 'east.mgr', PASS.eastMgr)
  await check('branch-manager-saves', bm, async () => {
    const east = `(select id from branches where name ilike 'East%' and clinic_id=(select clinic_id from profiles where username='east.mgr' or id in (select id from auth.users where email like 'east.mgr@%')) limit 1)`
    const pet = sql(`select id from pets where clinic_id=(select clinic_id from branches where id=${east}) and deleted_at is null order by created_at limit 1`)
    const reason = 'Sweep BM ' + stamp
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
    await bm.go('/appointments?pet=' + pet)
    const d = bm.locator('[role=dialog]')
    await d.locator('input[type=date]').fill(tomorrow)
    await d.getByLabel('Hour').selectOption('9'); await d.getByLabel('Minute').selectOption('00'); await d.locator('select').nth(2).selectOption('AM')
    await d.getByLabel('Reason').fill(reason)
    const docSel = d.locator('select').last(); const opts = await docSel.locator('option').all()
    if (opts.length > 1) await docSel.selectOption({ index: 1 })
    await d.locator('button[type=submit]').first().click(); await bm.waitForTimeout(2500)
    const anyway = d.getByRole('button', { name: /Schedule anyway/ }); if (await anyway.count()) { await anyway.click(); await bm.waitForTimeout(2500) }
    const row = sql(`select a.id, b.name from appointments a join branches b on b.id=a.branch_id where a.reason='${reason}'`)
    if (!row) throw new Error('branch manager booking not saved')
    const [id, branch] = row.split('|')
    sql(`update appointments set status='cancelled', cancellation_category='other', cancellation_reason='Sweep cleanup' where id='${id}'`)
    return `booked at branch "${branch}" (then cancelled)`
  })

  const admin = await login(b, 'staging.admin', PASS.admin)
  const NAME = `Sweep Test Clinic ${stamp}`
  await check('admin-clinic-lifecycle', admin, async () => {
    await admin.go('/clinics')
    await admin.getByRole('button', { name: /New clinic/ }).click(); await admin.waitForTimeout(800)
    await admin.getByLabel('Clinic name').first().fill(NAME)
    await admin.getByLabel(/full name/).fill('Sweep Manager')
    await admin.getByLabel(/username or email/).fill('sweep.mgr' + stamp)
    await admin.getByLabel(/password/).fill('SweepClinic' + stamp)
    await admin.getByRole('button', { name: /^Create clinic$/ }).click(); await admin.waitForTimeout(5000)
    const id = sql(`select id from clinics where name='${NAME}'`)
    if (!id) throw new Error('clinic not created')
    const steps = ['created']
    const row = () => admin.locator('li, .record-accordion-item').filter({ hasText: NAME }).first()
    await row().locator('.record-accordion-header').first().click().catch(() => {}); await admin.waitForTimeout(1200)
    for (const [btn, confirmName, sqlCheck, label] of [
      [/^Disable$/, NAME, `select disabled from clinics where id='${id}'`, 'disabled'],
      [/^Enable$/, null, `select not disabled from clinics where id='${id}'`, 'enabled again'],
      [/^Move to trash$/, NAME, `select deleted_at is not null from clinics where id='${id}'`, 'trashed'],
    ]) {
      const button = row().getByRole('button', { name: btn }).or(admin.getByRole('button', { name: btn })).first()
      await button.click(); await admin.waitForTimeout(1000)
      if (confirmName) await acceptNaming(admin, confirmName)
      await admin.waitForTimeout(3000)
      if (sql(sqlCheck) !== 't') throw new Error(`${label} not saved (after: ${steps.join(', ')})`)
      steps.push(label)
    }
    // Purge permanently, from "Deleted clinics".
    await admin.go('/clinics')
    await admin.getByRole('button', { name: /Deleted clinics/ }).click().catch(() => {}); await admin.waitForTimeout(1500)
    await admin.locator('li, .record-row, .record-accordion-item').filter({ hasText: NAME }).getByRole('button', { name: /Delete permanently/ }).first().click(); await admin.waitForTimeout(1000)
    await acceptNaming(admin, NAME); await admin.waitForTimeout(6000)
    if (sql(`select count(*) from clinics where id='${id}'`) !== '0') throw new Error(`purge did not remove the clinic (after: ${steps.join(', ')})`)
    steps.push('purged')
    return steps.join(' → ')
  })
  await b.close()
  console.log(results.join('\n'))
})()
