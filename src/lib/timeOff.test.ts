import { describe, expect, it } from 'vitest'
import { clinicTimeToIso, isAway, isoToClinicFields } from './timeOff'

describe('timeOff', () => {
  it('reads inputs as Riyadh time', () => {
    expect(clinicTimeToIso('2026-10-23', '00:00')).toBe('2026-10-22T21:00:00.000Z')
    expect(clinicTimeToIso('2026-10-23', '23:59')).toBe('2026-10-23T20:59:00.000Z')
  })

  it('round-trips back to the inputs', () => {
    expect(isoToClinicFields('2026-10-22T21:00:00.000Z')).toEqual({ date: '2026-10-23', time: '00:00' })
    expect(isoToClinicFields('2026-10-23T20:59:00.000Z')).toEqual({ date: '2026-10-23', time: '23:59' })
  })

  it('is away from start up to, not including, the end, for that doctor only', () => {
    const periods = [{ doctor_id: 'a', starts_at: clinicTimeToIso('2026-10-23', '00:00'), ends_at: clinicTimeToIso('2026-10-23', '12:00') }]
    expect(isAway(periods, 'a', clinicTimeToIso('2026-10-23', '00:00'))).toBe(true)
    expect(isAway(periods, 'a', clinicTimeToIso('2026-10-23', '11:45'))).toBe(true)
    expect(isAway(periods, 'a', clinicTimeToIso('2026-10-23', '12:00'))).toBe(false)
    expect(isAway(periods, 'a', clinicTimeToIso('2026-10-22', '23:45'))).toBe(false)
    expect(isAway(periods, 'b', clinicTimeToIso('2026-10-23', '09:00'))).toBe(false)
  })
})
