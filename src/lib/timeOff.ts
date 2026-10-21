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
