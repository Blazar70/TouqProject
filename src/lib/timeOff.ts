// Doctor time off (0058). Times are entered in clinic time, Asia/Riyadh (UTC+3, no DST).
export type AwayPeriod = { doctor_id: string; starts_at: string; ends_at: string }

const CLINIC_TZ = 'Asia/Riyadh'

// Date and time inputs ("2026-10-23", "00:00") as a UTC ISO timestamp.
export function clinicTimeToIso(date: string, time: string) {
  return new Date(`${date}T${time}:00+03:00`).toISOString()
}

// The reverse, to prefill the inputs when editing.
export function isoToClinicFields(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: CLINIC_TZ }),
    time: d.toLocaleTimeString('en-GB', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  }
}

// Same rule as the DB trigger: away from start up to (not including) the end.
export function isAway(periods: AwayPeriod[], doctorId: string, at: string) {
  const time = new Date(at).getTime()
  return periods.some(
    (p) => p.doctor_id === doctorId && time >= new Date(p.starts_at).getTime() && time < new Date(p.ends_at).getTime(),
  )
}

// shortcut: clinics have no opening hours yet, so free times run 8 AM–10 PM clinic time; use the clinic's hours once they exist.
const FREE_FROM = '08:00'
const FREE_SLOTS = 28 // 30-minute starts, 8:00 … 21:30
const BLOCK_MS = 30 * 60_000

// H49: the doctor's free 30-minute starts on `day`, from now on: not overlapping a booking (all blocks are 30 min)
// and not in time off. `booked` = scheduled_at of the doctor's non-cancelled appointments that day.
export function freeSlots(day: string, doctorId: string, booked: string[], away: AwayPeriod[], now = Date.now(), limit = 8) {
  const taken = booked.map((at) => new Date(at).getTime())
  const first = new Date(clinicTimeToIso(day, FREE_FROM)).getTime()
  const free: string[] = []
  for (let i = 0; i < FREE_SLOTS && free.length < limit; i++) {
    const start = first + i * BLOCK_MS
    if (start < now || taken.some((t) => Math.abs(t - start) < BLOCK_MS)) continue
    const iso = new Date(start).toISOString()
    if (!isAway(away, doctorId, iso)) free.push(iso)
  }
  return free
}
