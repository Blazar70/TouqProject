// Sweep script (11-01: H49, H50, lock-screen message; see README.md). Staging only.
// Booking: free-time chips for the chosen doctor and day, one tap fills hour/minute/AM-PM (nothing saved) ->
// a 4000x3000 phone-size photo on the test pet "Sweep Kitten" is stored shrunk (H50) -> a wrong password on the
// lock screen says only "Wrong password" (no username/email).
// Run against a local build: SWEEP_SITE=http://localhost:5175 node scripts/sweep/j19-booking-photo-lock-1101.cjs
const { chromium } = require('./config.cjs').playwright
const { SITE, OUT: out, PASS, SPSQL } = require('./config.cjs')
const sql = (q) => require('child_process').execFileSync('node', [SPSQL, '-A', '-t', '-c', q]).toString().split(String.fromCharCode(13)).join('').trim()
const PET = '30359b93-8e11-481b-988c-e84be20ff062' // Sunny, for the booking form only
const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
let failed = 0
const expect = (c, m) => { if (!c) throw new Error(m) }
async function step(page, name, fn) {
  try { const note = await fn(); console.log('ok', name + (note ? ' — ' + note : '')) } catch (e) {
    failed++
    console.log('FAIL', name, '-', e.message.split('\n')[0].slice(0, 220))
    await page.screenshot({ path: out + `j19-fail-${name.replace(/\W+/g, '-').slice(0, 50)}.png`, fullPage: true }).catch(() => {})
  }
}

;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const ctx = await b.newContext({ timezoneId: 'Asia/Riyadh', viewport: { width: 1180, height: 820 } })
  await ctx.addInitScript(() => localStorage.setItem('touq-language', 'en'))
  const p = await ctx.newPage()
  await p.goto(SITE); await p.fill('input[autocomplete=username]', 'amal.desk'); await p.fill('input[type=password]', PASS.demoStaff)
  await p.click('form.login-form button[type=submit]'); await p.waitForTimeout(4000)

  await step(p, 'H49: free-time chips fill the time with one tap', async () => {
    await p.goto(SITE + '/appointments?pet=' + PET)
    await p.waitForSelector('[role=dialog] input[type=date]', { timeout: 8000 })
    const dlg = p.locator('[role=dialog]')
    await dlg.locator('input[type=date]').fill(tomorrow)
    const doc = dlg.locator('select').last()
    await doc.selectOption(await doc.locator('option', { hasText: 'Khalid' }).first().getAttribute('value'))
    await p.waitForTimeout(2000)
    const chips = dlg.locator('.free-times-list button')
    expect((await chips.count()) > 1, 'no free-time chips')
    const label = (await chips.nth(1).innerText()).trim()
    await chips.nth(1).click(); await p.waitForTimeout(300)
    const shown = `${await dlg.getByLabel('Hour').inputValue()}:${await dlg.getByLabel('Minute').inputValue()} ${await dlg.locator('select').nth(2).inputValue()}`
    expect(label.replace(/\s/g, '') === shown.replace(/\s/g, ''), `chip "${label}" filled ${shown}`)
    expect((await chips.nth(1).getAttribute('aria-pressed')) === 'true', 'picked chip not marked')
    // Khalid's booked times tomorrow must not be offered.
    const booked = sql(`select string_agg(to_char(scheduled_at at time zone 'Asia/Riyadh', 'FMHH12:MI AM'), ',') from appointments a join profiles d on d.id = a.doctor_id where d.full_name like '%Khalid%' and a.status <> 'cancelled' and (a.scheduled_at at time zone 'Asia/Riyadh')::date = '${tomorrow}'`)
    const offered = (await chips.allInnerTexts()).map((s) => s.trim())
    const clash = (booked || '').split(',').filter((t) => t && offered.includes(t))
    await p.screenshot({ path: out + 'j19-free-times.png' })
    expect(!clash.length, 'booked times offered: ' + clash.join(', '))
    await p.keyboard.press('Escape'); await p.waitForTimeout(500)
    const c = p.getByRole('alertdialog')
    if (await c.count()) await c.locator('button:not(.cancel-button)').first().click()
    return `${offered.length} chips (${offered.join(' ')}); booked tomorrow: ${booked || 'none'}`
  })

  await step(p, 'H50: a 4000x3000 photo is stored shrunk', async () => {
    const pet = sql(`select id from pets where name = 'Sweep Kitten' and deleted_at is null limit 1`)
    expect(pet, 'no Sweep Kitten test pet')
    // A noisy phone-size JPEG (noise defeats compression, like a real photo).
    const base64 = await p.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 4000; c.height = 3000
      const g = c.getContext('2d'); const img = g.createImageData(4000, 3000)
      for (let i = 0; i < img.data.length; i += 4) { img.data[i] = Math.random() * 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = 128; img.data[i + 3] = 255 }
      g.putImageData(img, 0, 0)
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92))
      return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob) })
    }).catch(() => null)
    expect(base64, 'could not make the test photo')
    const big = Buffer.from(base64, 'base64')
    require('fs').writeFileSync(out + 'j19-big.jpg', big)
    await p.goto(SITE + '/pets/' + pet); await p.waitForTimeout(3500)
    await p.locator('section', { has: p.getByRole('heading', { name: 'Pet details' }) }).getByRole('button', { name: /^Edit$/ }).click()
    await p.locator('input[type=file]').first().setInputFiles(out + 'j19-big.jpg'); await p.waitForTimeout(800)
    await p.getByRole('button', { name: 'Save changes' }).click(); await p.waitForTimeout(6000)
    const size = sql(`select o.metadata->>'size' from storage.objects o join pets p on o.name = split_part(p.photo_url, '?', 1) where p.id = '${pet}' and o.bucket_id = 'pet-photos'`)
    expect(size && +size < 1.5 * 1024 * 1024 && +size < big.length, `stored ${size} bytes from ${big.length}`)
    return `${(big.length / 1048576).toFixed(1)} MB picked → ${(+size / 1024).toFixed(0)} KB stored`
  })

  await step(p, 'lock screen: a wrong password says only "Wrong password"', async () => {
    await p.evaluate(() => localStorage.setItem('touq.locked', '1'))
    await p.reload(); await p.waitForTimeout(3000)
    await p.getByLabel(/Password/).fill('definitely-wrong')
    await p.getByRole('button', { name: 'Unlock' }).click(); await p.waitForTimeout(3000)
    const text = await p.locator('.lock-screen').innerText()
    await p.screenshot({ path: out + 'j19-lock-wrong.png' })
    await p.getByLabel(/Password/).fill(PASS.demoStaff)
    await p.getByRole('button', { name: 'Unlock' }).click(); await p.waitForTimeout(3000)
    expect(text.includes('Wrong password. Try again.') && !/username|email/i.test(text), 'lock text: ' + text.replace(/\s+/g, ' ').slice(0, 200))
  })

  await b.close()
  console.log(failed ? `${failed} FAILED` : 'all passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
