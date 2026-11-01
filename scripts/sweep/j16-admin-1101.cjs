// Sweep script (11-01: admin items from the handoff's untested list; see README.md). Staging only.
// Admin creates a throwaway clinic -> trash -> "Deleted clinics (n)" counts it -> purge; the purge reply is changed
// in the browser to report files left, so the "files left" warning shows (a real storage failure can't be forced).
// Every confirm must name the test clinic before it is accepted; the purge confirm needs the name typed (H51).
// Run against a local build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j16-admin-1101.cjs
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
const RUN = Date.now().toString().slice(-5)
const NAME = 'Sweep Test Clinic ' + RUN

async function acceptNaming(p, expected) {
  const c = p.getByRole('alertdialog')
  const text = await c.innerText()
  if (!text.includes(expected)) { await c.getByRole('button', { name: /^Cancel$/ }).click(); throw new Error(`confirm did not name "${expected}": ${text.slice(0, 90)}`) }
  const box = c.locator('input') // permanent deletes ask for the name to be typed (H51)
  if (await box.count()) await box.fill(expected)
  await c.locator('button:not(.cancel-button)').first().click()
}

;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript(() => localStorage.setItem('touq-language', 'en'))
  const a = await ctx.newPage()
  try {
    await a.goto(SITE); await a.fill('input[autocomplete=username]', 'staging.admin'); await a.fill('input[type=password]', PASS.admin)
    await a.click('form.login-form button[type=submit]'); await a.waitForTimeout(4000)
    await a.goto(SITE + '/clinics'); await a.waitForTimeout(3500)
    const deletedBefore = +((await a.getByRole('button', { name: /Deleted clinics/ }).innerText().catch(() => '(0)')).match(/\((\d+)\)/) ?? [0, 0])[1]
    await a.getByRole('button', { name: /New clinic/ }).click(); await a.waitForTimeout(800)
    await a.getByLabel('Clinic name').first().fill(NAME)
    await a.getByLabel(/full name/).fill('Sweep Manager')
    await a.getByLabel(/username or email/).fill('sweep.mgr' + RUN)
    await a.getByLabel(/password/).fill('SweepClinic' + RUN)
    await a.getByRole('button', { name: /^Create clinic$/ }).click(); await a.waitForTimeout(5000)
    const id = sql(`select id from clinics where name = '${NAME}'`)
    if (!id) throw new Error('clinic not created')
    const row = a.locator('.record-accordion-item').filter({ hasText: NAME }).first()
    await row.locator('.record-accordion-header').first().click(); await a.waitForTimeout(1200)
    await row.getByRole('button', { name: /^Move to trash$/ }).click(); await a.waitForTimeout(1000)
    await acceptNaming(a, NAME); await a.waitForTimeout(3000)
    // The toast shows before the list has reloaded: wait for the count.
    await a.getByRole('button', { name: `Deleted clinics (${deletedBefore + 1})` }).waitFor({ timeout: 15000 }).catch(() => {})
    const deleted = await a.getByRole('button', { name: /Deleted clinics/ }).innerText()
    if (!deleted.includes(`(${deletedBefore + 1})`)) throw new Error(`"${deleted}" after trashing (was ${deletedBefore})`)
    console.log('ok Deleted clinics count:', deleted)

    await a.route('**/functions/v1/admin-manage-clinic', async (route) => {
      const body = route.request().postDataJSON()
      const response = await route.fetch()
      const json = await response.json()
      await route.fulfill({ response, json: body?.action === 'purge' && json.ok !== false && !json.error ? { ...json, storageFailures: 1 } : json })
    })
    await a.getByRole('button', { name: /Deleted clinics/ }).click(); await a.waitForTimeout(1500)
    await a.locator('li, .record-row, .record-accordion-item').filter({ hasText: NAME }).getByRole('button', { name: /Delete permanently/ }).first().click(); await a.waitForTimeout(4000)
    // H51: past the 3 s countdown the button stays off until the exact name is typed.
    const dlg = a.getByRole('alertdialog')
    const go = dlg.locator('button:not(.cancel-button)').first()
    if (!(await go.isDisabled())) throw new Error('purge confirm enabled without typing the name')
    await dlg.locator('input').fill(NAME.slice(0, -1))
    if (!(await go.isDisabled())) throw new Error('purge confirm enabled with a wrong name')
    console.log('ok H51: purge needs the exact clinic name')
    await acceptNaming(a, NAME)
    const warning = a.getByText(`${NAME} was deleted, but some of its files could not be removed`)
    const warned = await warning.waitFor({ timeout: 15000 }).then(() => true, () => false)
    await a.screenshot({ path: out + 'j16-files-left.png' })
    if (sql(`select count(*) from clinics where id = '${id}'`) !== '0') throw new Error('purge did not remove the clinic')
    // The trash list reloads after the toast: the purged clinic must leave it.
    await a.locator('[role=dialog]').getByText(NAME).waitFor({ state: 'detached', timeout: 15000 }).catch(() => { throw new Error('purged clinic still listed in the trash') })
    if (!warned) throw new Error('no "files left" warning after the purge')
    console.log('ok purge with files left shows the warning')
    console.log('all passed')
  } catch (e) {
    console.log('FAIL', e.message.split('\n')[0].slice(0, 220))
    await a.screenshot({ path: out + 'j16-fail.png', fullPage: true })
    process.exitCode = 1
  }
  await b.close()
})()
