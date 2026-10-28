// Sweep script (saved 10-28; see README.md). Staging only.
// Journey 8 (demo clinic, saves; only touches the sweep's own test pet/owner/staff):
// doctor admits Sweep Kitten + medicine reminder + Done + Undo + Stop + discharge · manager edits Sweep Test Nurse's title ·
// manager deletes the personal data of the test owner "سارة الاختبار".
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const { execFileSync } = require('child_process')
const sql = (q) => execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().trim()
const KITTEN = sql(`select id from pets where name = 'Sweep Kitten'`)
const OWNER = sql(`select owner_file_id from pets where name = 'Sweep Kitten'`)
if (!KITTEN || KITTEN.includes('\n') || !OWNER || OWNER.includes('\n')) { console.log('ABORT: test pet/owner not unique', KITTEN, OWNER); process.exit(1) }
async function login(b, user, pass) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => localStorage.setItem('touq-language', 'en'))
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 140)))
  p.pick = async () => { const bp = p.locator('.branch-picker-list button', { hasText: 'Al Olaya' }).first(); if (await bp.count()) { await bp.click(); await p.waitForTimeout(2000) } }
  await p.goto(SITE); await p.fill('input[autocomplete=username]', user); await p.fill('input[type=password]', pass)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000); await p.pick()
  return p
}
const accept = async (p, name) => { const c = p.getByRole('alertdialog'); if (await c.count()) { await c.getByRole('button', name ? { name } : undefined).filter({ hasNotText: /^Cancel$/ }).last().click() } }
async function step(p, name, fn) { try { await fn(); console.log('ok', name) } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 160)); await p.screenshot({ path: out + `j8-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true }) } }
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const d = await login(b, 'khalid.vet', PASS.demoStaff)
  await step(d, 'doctor: admit + medicine reminder + Done/Undo/Stop + discharge', async () => {
    await d.goto(SITE + '/pets/' + KITTEN); await d.waitForTimeout(3500); await d.pick()
    await d.getByRole('button', { name: /^Admit$/ }).click(); await d.getByRole('button', { name: /^Admit at/ }).click(); await d.waitForTimeout(3000)
    await d.getByRole('button', { name: /Add reminder/ }).click(); await d.waitForTimeout(600)
    await d.getByLabel('What').fill('Sweep Amoxicillin 50 mg')
    await d.getByLabel('Every (hours)').fill('8')
    // First dose 10 minutes ago (clinic time), so it is due now.
    const now = new Date(Date.now() - 10 * 60000).toLocaleString('sv-SE', { timeZone: 'Asia/Riyadh' }).slice(0, 16).replace(' ', 'T')
    await d.getByLabel('First time').fill(now)
    await d.getByRole('button', { name: 'Save reminder' }).click(); await d.waitForTimeout(3000)
    await d.getByRole('button', { name: 'Done' }).first().click(); await d.waitForTimeout(2500)
    const doses = () => sql(`select count(*) from inpatient_task_doses x join inpatient_tasks t on t.id=x.task_id join inpatient_stays s on s.id=t.stay_id where s.pet_id='${KITTEN}'`)
    console.log('  doses after Done:', doses())
    await d.getByRole('button', { name: 'Undo' }).first().click(); await d.waitForTimeout(1000); await accept(d); await d.waitForTimeout(2500)
    console.log('  doses after Undo:', doses())
    await d.getByRole('button', { name: /^Stop$/ }).first().click(); await d.waitForTimeout(800); await accept(d, 'Stop'); await d.waitForTimeout(2500)
    console.log('  reminder stopped:', sql(`select count(*) from inpatient_tasks t join inpatient_stays s on s.id=t.stay_id where s.pet_id='${KITTEN}' and t.stopped_at is not null`))
    await d.getByRole('button', { name: /^Discharge$/ }).click(); await d.waitForTimeout(600)
    await d.locator('form:has(input[type=radio]) input[type=radio]').first().check()
    await d.locator('form:has(input[type=radio]) button[type=submit]').click(); await d.waitForTimeout(1000); await accept(d); await d.waitForTimeout(2500)
  })
  const m = await login(b, 'MohBaf@touq.app', PASS.cofounder)
  await step(m, 'manager edits Sweep Test Nurse title', async () => {
    await m.goto(SITE + '/staff'); await m.waitForTimeout(4000); await m.pick()
    // Removed staff can be edited? Sweep Test Nurse is in "Removed staff" now; restore first, then edit.
    const removed = m.locator('section', { has: m.getByRole('heading', { name: 'Removed staff' }) }).locator('li.pet-list-item').filter({ hasText: 'Sweep Test Nurse' })
    if (await removed.count() === 1) { await removed.getByRole('button', { name: 'Restore' }).click(); await m.waitForTimeout(1000); await accept(m); await m.waitForTimeout(3000) }
    const row = m.locator('li.pet-list-item').filter({ hasText: 'Sweep Test Nurse' })
    if ((await row.count()) !== 1) throw new Error('expected one Sweep Test Nurse row')
    await row.getByRole('button', { name: 'Edit' }).click(); await m.waitForTimeout(1000)
    await m.getByLabel('Title').first().fill('Sweep night nurse')
    await m.getByRole('button', { name: /^Save/ }).first().click(); await m.waitForTimeout(3000)
    console.log('  title now:', sql(`select title, disabled from profiles where full_name='Sweep Test Nurse'`))
  })
  await step(m, 'manager deletes the test owner personal data', async () => {
    await m.goto(SITE + '/owners'); await m.waitForTimeout(3500); await m.pick()
    const row = m.locator('li.pet-list-item, .data-row').filter({ hasText: 'سارة الاختبار' })
    if ((await row.count()) < 1) throw new Error('test owner row not found')
    await row.getByRole('button', { name: 'Open' }).first().click(); await m.waitForTimeout(2500)
    await m.getByRole('button', { name: 'Delete personal data' }).first().click(); await m.waitForTimeout(800)
    const dlg = m.locator('[role=dialog]').last()
    const submit = dlg.getByRole('button', { name: 'Delete personal data' })
    console.log('  delete disabled before typing:', await submit.isDisabled())
    await dlg.locator('input').first().fill('0550000999')
    console.log('  delete enabled after typing the phone:', await submit.isEnabled())
    await submit.click(); await m.waitForTimeout(1000); await accept(m); await m.waitForTimeout(3500)
    console.log('  owner now:', sql(`select name, phone is null, anonymised_at is not null from owner_files where id='${OWNER}'`))
  })
  await b.close()
})()
