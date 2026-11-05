// Sweep script (11-04: fixes from the nightly reports of 11-02/03/04; see README.md). Staging only.
// B36 + H57 + H60 photos, B38 + H61 profile failure, B39 + H63 staff list, B40 + H64 + H65 billing, H53 free times,
// H54 register from booking, H56 Arabic type-to-confirm, H59 age. Saves a throwaway clinic (purged), a pet "Sweep1104 n"
// and a visit on the demo clinic (wiped in the v2 reset).
// Run against a local staging build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j22-nightly-1104.cjs
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
const RUN = Date.now().toString().slice(-5)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const png = { name: 'ok.png', mimeType: 'image/png', buffer: PNG }
const heic = { name: 'phone.heic', mimeType: 'image/heic', buffer: Buffer.alloc(3 * 1024 * 1024) }
let failed = 0
const expect = (ok, what) => { if (!ok) throw new Error(what) }

async function login(b, user, pass, lang = 'en', options = {}) {
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 }, ...options })
  await ctx.addInitScript((l) => localStorage.setItem('touq-language', l), lang)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 160)))
  await p.goto(SITE); await p.fill('input[autocomplete=username]', user); await p.fill('input[type=password]', pass)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000)
  const pick = p.locator('.branch-picker-list button').first()
  if (await pick.count()) { await pick.click(); await p.waitForTimeout(1500) }
  return p
}
async function step(p, name, fn) {
  try { await fn(); console.log('ok', name) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 220))
    await p.screenshot({ path: out + `j22-fail-${name.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {})
  }
}

;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })

  // Reception: free times, register from booking, age, photo checks, profile failure.
  const r = await login(b, 'amal.desk', PASS.demoStaff)
  const future = new Date(Date.now() + 40 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
  const PET_NAME = 'Sweep1104 ' + RUN
  await step(r, 'H53 free times grouped over the whole day', async () => {
    await r.goto(SITE + '/appointments'); await r.waitForTimeout(3000)
    await r.getByRole('button', { name: /New appointment/ }).first().click(); await r.waitForTimeout(800)
    const d = r.locator('[role=dialog]')
    await d.locator('input[type=date]').fill(future)
    const doc = d.locator('select').last()
    await doc.selectOption(await doc.locator('option', { hasText: 'Khalid' }).first().getAttribute('value'))
    await r.waitForSelector('.free-times-group', { timeout: 8000 })
    const groups = await d.locator('.free-times-group').count()
    expect(groups === 3, `${groups} groups on an empty day`)
    const more = d.getByRole('button', { name: /^\+\d+ more$/ }).first()
    const before = await d.locator('.free-times-group').first().locator('button').count()
    await more.click()
    expect((await d.locator('.free-times-group').first().locator('button').count()) > before, '+N more did not open')
    await d.locator('.free-times-group').last().locator('button').first().click()
    await r.screenshot({ path: out + 'j22-free-times.png' })
  })
  await step(r, 'H54 register from the booking keeps the form', async () => {
    const d = r.locator('[role=dialog]')
    await d.getByLabel('Reason').fill('Sweep1104 reason')
    await d.locator('.pet-picker > input').fill(PET_NAME)
    await d.getByRole('link', { name: 'Register new pet' }).click({ timeout: 8000 }); await r.waitForTimeout(1500)
    expect(!(await r.getByRole('alertdialog').count()), 'unsaved-changes dialog on the way out')
    expect(r.url().includes('back=appointments'), 'no back in ' + r.url())
    expect((await r.getByLabel('Name', { exact: false }).first().inputValue()) === PET_NAME, 'name not prefilled')
  })
  await step(r, 'B36 HEIC refused at pick time, H59 age fills the date', async () => {
    await r.locator('input[type=file]').setInputFiles(heic); await r.waitForTimeout(800)
    expect(await r.getByText(/photo format \(HEIC\)/).count(), 'no HEIC message')
    await r.locator('input[type=file]').setInputFiles(png); await r.waitForTimeout(800)
    expect(!(await r.getByText(/photo format \(HEIC\)/).count()), 'HEIC message stayed after a good photo')
    expect(await r.locator('img.pet-avatar').count(), 'no preview')
    await r.getByLabel(/Or age: years/).fill('2')
    const dob = await r.locator('input[type=date]').inputValue()
    const expected = String(+new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).slice(0, 4) - 2)
    expect(dob.startsWith(expected), 'date of birth ' + dob)
    await r.screenshot({ path: out + 'j22-register.png', fullPage: true })
  })
  await step(r, 'H54 comes back to the booking with the new pet and the draft', async () => {
    await r.getByText('Select a species').click()
    await r.getByRole('option').first().click()
    await r.getByLabel(/Owner name|Owner's name/i).fill('Sweep Owner ' + RUN)
    await r.locator('input[type=tel]').first().fill('50' + RUN + '12')
    await r.getByRole('button', { name: 'Register pet' }).click()
    await r.waitForSelector('[role=dialog] input[type=date]', { timeout: 10000 }); await r.waitForTimeout(2500)
    expect(r.url().endsWith('/appointments'), 'url ' + r.url())
    const d = r.locator('[role=dialog]')
    expect((await d.locator('.pet-picker > input').inputValue()).includes(PET_NAME), 'pet not picked')
    expect((await d.locator('input[type=date]').inputValue()) === future, 'date lost')
    expect((await d.getByLabel('Reason').inputValue()) === 'Sweep1104 reason', 'reason lost')
    expect(await d.locator('select').last().locator('option:checked', { hasText: 'Khalid' }).count(), 'doctor lost')
    expect(sql(`select photo_url is not null from pets where name = '${PET_NAME}'`) === 't', 'photo not saved on the pet')
    await r.screenshot({ path: out + 'j22-back-to-booking.png' })
  })
  await step(r, 'B38 + H61 failed profile shows the error, Try again recovers', async () => {
    await r.context().route('**/rest/v1/profiles*', (route) => route.abort())
    // beforeunload: the booking form above has unsaved text.
    r.once('dialog', (dlg) => dlg.accept())
    await r.reload(); await r.waitForTimeout(3000)
    await r.getByRole('heading', { name: "Couldn't load your account" }).waitFor({ timeout: 8000 })
    await r.screenshot({ path: out + 'j22-profile-failed.png' })
    await r.getByRole('button', { name: 'Try again' }).click()
    // supabase-js retries a dropped request for a few seconds first: back to the error screen, not into an empty app.
    await r.getByRole('heading', { name: "Couldn't load your account" }).waitFor({ timeout: 15000 })
    await r.context().unroute('**/rest/v1/profiles*')
    await r.getByRole('button', { name: 'Try again' }).click(); await r.waitForTimeout(3000)
    expect(!(await r.getByRole('heading', { name: "Couldn't load your account" }).count()), 'still on the error screen')
    expect(await r.getByRole('link', { name: /Payments/ }).count(), 'no money menu after recovery')
  })
  await step(r, 'H61 retries by itself when the connection returns', async () => {
    await r.context().route('**/rest/v1/profiles*', (route) => route.abort())
    await r.reload(); await r.getByRole('heading', { name: "Couldn't load your account" }).waitFor({ timeout: 8000 })
    await r.context().unroute('**/rest/v1/profiles*')
    await r.evaluate(() => window.dispatchEvent(new Event('online'))); await r.waitForTimeout(3000)
    expect(!(await r.getByRole('heading', { name: "Couldn't load your account" }).count()), 'no retry on online')
  })

  // Manager: staff list.
  const m = await login(b, 'MohBaf@touq.app', PASS.cofounder)
  await step(m, 'B39 + H63 staff appointments load and group', async () => {
    await m.goto(SITE + '/staff'); await m.waitForTimeout(3000)
    const pick = m.locator('.branch-picker-list button').first()
    if (await pick.count()) { await pick.click(); await m.waitForTimeout(1500) }
    await m.locator('button', { hasText: /Khalid/ }).first().click(); await m.waitForTimeout(2500)
    const box = m.locator('.staff-appointments').first()
    expect(!(await box.locator('.form-error, [role=alert]').count()), 'error: ' + (await box.innerText()).slice(0, 100))
    const total = sql(`select count(*) from appointments a join profiles p on p.id = a.doctor_id where p.full_name ilike '%Khalid%' and a.clinic_id = p.clinic_id and a.status not in ('completed','cancelled')`)
    if (+total > 0) expect(await box.locator('h4').count(), 'no group headings with ' + total + ' open appointments')
    await m.screenshot({ path: out + 'j22-staff.png', fullPage: true })
  })

  // Doctor: a failed photo upload during a visit.
  const d = await login(b, 'khalid.vet', PASS.demoStaff)
  const ids = sql(`select p.id || '|' || p.clinic_id from pets p where p.deleted_at is null and p.clinic_id = (select clinic_id from profiles where full_name ilike '%Khalid%' limit 1) and p.name not like 'Sweep%' limit 1`).split('|')
  const reason = 'Sweep1104 visit ' + RUN
  const doctor = sql(`select id from profiles where full_name ilike '%Khalid%' and clinic_id = '${ids[1]}' limit 1`)
  const branch = sql(`select branch_id from staff_branches where profile_id = '${doctor}' limit 1`)
  sql(`insert into appointments (clinic_id, pet_id, doctor_id, created_by, branch_id, scheduled_at, status, reason) values ('${ids[1]}', '${ids[0]}', '${doctor}', '${doctor}', '${branch}', now(), 'arrived', '${reason}')`)
  const appt = sql(`select id from appointments where reason = '${reason}'`)
  await step(d, 'H60 failed photo: visit saved, photo kept, no retry loop, Save retries', async () => {
    await d.goto(SITE + '/appointments?open=' + appt); await d.waitForTimeout(3000)
    await d.getByRole('button', { name: /Start session/ }).first().click()
    await d.waitForURL(/\/session/, { timeout: 8000 }); await d.waitForTimeout(2500)
    expect(!(await d.locator('.touch-only').isVisible()), 'dictation tip shown with a mouse')
    let uploads = 0
    await d.context().route('**/storage/v1/object/pet-photos/**', (route) => { uploads++; route.abort() })
    await d.locator('form.session-form input[type=file]').setInputFiles(png); await d.waitForTimeout(500)
    await d.getByLabel(/Presenting complaint/i).fill('Sweep1104 complaint')
    await d.getByRole('button', { name: /^Save$/ }).click(); await d.waitForTimeout(2500)
    expect(await d.getByText(/Visit saved, but the photo could not be uploaded/).count(), 'no "visit saved, photo not" message')
    expect(await d.getByText(/not saved yet\. Press Save/).count(), 'no retry hint')
    expect(sql(`select presenting_complaint from medical_records where appointment_id = '${appt}'`).includes('Sweep1104'), 'record not saved')
    const afterFirst = uploads
    await d.waitForTimeout(13000)
    expect(uploads === afterFirst, `autosave kept retrying: ${uploads} uploads vs ${afterFirst}`)
    await d.context().unroute('**/storage/v1/object/pet-photos/**')
    await d.getByRole('button', { name: /^Save$/ }).click(); await d.waitForTimeout(3000)
    expect(sql(`select photo_url is not null from medical_records where appointment_id = '${appt}'`) === 't', 'photo not saved on retry')
    expect(!(await d.getByText(/not saved yet\. Press Save/).count()), 'retry hint stayed')
  })
  await step(d, 'B36 inpatient update checks files at pick time', async () => {
    const pet = sql(`select pet_id from inpatient_stays where clinic_id = '${ids[1]}' and discharged_at is null limit 1`)
    expect(pet, 'no open stay on the demo clinic')
    await d.goto(SITE + '/pets/' + pet); await d.waitForTimeout(3500)
    const input = d.locator('input[type=file][accept*="video"]')
    await input.setInputFiles(heic); await d.waitForTimeout(800)
    expect(await d.getByText(/photo format \(HEIC\)/).count(), 'no HEIC message')
    await input.setInputFiles(png); await d.waitForTimeout(800)
    expect(!(await d.getByText(/photo format \(HEIC\)/).count()), 'good photo still refused')
  })
  sql(`update appointments set status = 'cancelled', cancellation_category = 'other', cancellation_reason = 'sweep' where id = '${appt}'`)

  // Admin: billing and the Arabic purge confirm, on a throwaway clinic.
  const a = await login(b, 'staging.admin', PASS.admin)
  const NAME = 'مسح أحمد الإدارة ' + RUN
  const TYPED = 'مسح احمد الاداره ' + RUN
  let clinicId = ''
  await step(a, 'create a throwaway clinic with an Arabic name', async () => {
    await a.goto(SITE + '/clinics'); await a.waitForTimeout(3500)
    await a.getByRole('button', { name: /New clinic/ }).click(); await a.waitForTimeout(800)
    await a.getByLabel('Clinic name').first().fill(NAME)
    await a.getByLabel(/full name/).fill('Sweep Manager')
    await a.getByLabel(/username or email/).fill('sweep.mgr' + RUN)
    await a.getByLabel(/password/).fill('SweepClinic' + RUN)
    await a.getByRole('button', { name: /^Create clinic$/ }).click()
    await a.waitForTimeout(500)
    await a.getByRole('button', { name: /^Saving/ }).waitFor({ state: 'detached', timeout: 45000 })
    await a.waitForTimeout(1000)
    // By the digits: Arabic in a psql argument doesn't survive the Windows command line.
    clinicId = sql(`select id from clinics where name like '%${RUN}'`)
    expect(clinicId, 'clinic not created')
  })
  await step(a, 'H65 view PDF opens, H64 Arabic status search, B40 file survives a failed delete', async () => {
    const pay = sql(`insert into payments (clinic_id, amount, status, paid_at) values ('${clinicId}', 12.5, 'paid', now()) returning id`).split('\n')[0]
    const objects = () => sql(`select count(*) from storage.objects where bucket_id = 'payment-documents' and name like '${clinicId}/%'`)
    await a.goto(SITE + '/billing'); await a.waitForTimeout(3000)
    const row = a.locator('li.pet-list-item').filter({ hasText: NAME })
    await row.locator('input[type=file]').setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') }); await a.waitForTimeout(2500)
    expect(objects() === '1', 'pdf not stored')
    const [tab] = await Promise.all([a.context().waitForEvent('page', { timeout: 8000 }), row.getByRole('button', { name: 'View PDF' }).click()])
    await tab.waitForURL(/payment-documents/, { timeout: 8000 })
    await tab.close()
    const ar = await login(b, 'staging.admin', PASS.admin, 'ar')
    await ar.goto(SITE + '/billing'); await ar.waitForTimeout(3000)
    await ar.locator('.search-input').fill('مدفوعه')
    expect(await ar.locator('li.pet-list-item').filter({ hasText: RUN }).count(), 'Arabic status search found nothing')
    await ar.locator('.search-input').fill('ملغاه غير موجوده')
    expect(!(await ar.locator('li.pet-list-item').filter({ hasText: RUN }).count()), 'search matches anything')
    await ar.context().close()
    const del = () => a.locator('li.pet-list-item').filter({ hasText: NAME }).getByRole('button', { name: 'Delete' })
    const confirmDelete = async () => {
      await del().click(); await a.waitForTimeout(3600)
      await a.getByRole('alertdialog').locator('button:not(.cancel-button)').first().click(); await a.waitForTimeout(2500)
    }
    await a.context().route('**/rest/v1/payments*', (route) => route.request().method() === 'DELETE' ? route.abort() : route.continue())
    await confirmDelete()
    expect(objects() === '1', 'B40: file removed although the record stayed')
    expect(sql(`select count(*) from payments where id = '${pay}'`) === '1', 'record gone')
    await a.context().unroute('**/rest/v1/payments*')
    await confirmDelete()
    expect(sql(`select count(*) from payments where id = '${pay}'`) === '0', 'record not deleted')
    expect(objects() === '0', 'file left after a successful delete')
  })
  await step(a, 'H56 purge confirm accepts Arabic letter variants', async () => {
    await a.goto(SITE + '/clinics'); await a.waitForTimeout(3500)
    const row = a.locator('.record-accordion-item').filter({ hasText: NAME }).first()
    await row.locator('.record-accordion-header').first().click(); await a.waitForTimeout(1200)
    await row.getByRole('button', { name: /^Move to trash$/ }).click(); await a.waitForTimeout(1000)
    let c = a.getByRole('alertdialog')
    if (await c.locator('input').count()) await c.locator('input').fill(NAME)
    await a.waitForTimeout(3200)
    await c.locator('button:not(.cancel-button)').first().click(); await a.waitForTimeout(4000)
    await a.getByRole('button', { name: /Deleted clinics/ }).click(); await a.waitForTimeout(1500)
    await a.locator('li, .record-row, .record-accordion-item').filter({ hasText: NAME }).getByRole('button', { name: /Delete permanently/ }).first().click(); await a.waitForTimeout(4000)
    c = a.getByRole('alertdialog')
    const go = c.locator('button:not(.cancel-button)').first()
    expect(await c.locator('bdi strong', { hasText: NAME }).count(), 'name not shown on its own')
    expect(await go.isDisabled(), 'enabled before typing')
    await c.locator('input').fill(TYPED.slice(0, -1))
    expect(await go.isDisabled(), 'enabled with a wrong name')
    await c.locator('input').fill(TYPED)
    expect(await go.isEnabled(), 'variant spelling refused')
    await a.screenshot({ path: out + 'j22-purge.png' })
    await go.click(); await a.waitForTimeout(6000)
    expect(sql(`select count(*) from clinics where id = '${clinicId}'`) === '0', 'clinic not purged')
  })

  await b.close()
  console.log(failed ? `${failed} step(s) failed` : 'all passed')
  process.exitCode = failed ? 1 : 0
})()
