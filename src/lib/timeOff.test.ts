import { describe, expect, it } from 'vitest'
import { clinicTimeToIso, freeSlots, isAway, isoToClinicFields, slotPeriod } from './timeOff'

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

describe('freeSlots (H49)', () => {
  const at = (time: string) => clinicTimeToIso('2026-11-03', time)
  const early = new Date(at('00:00')).getTime()
  it('skips booked blocks, overlaps and time off, from 8 AM in clinic time', () => {
    const away = [{ doctor_id: 'd1', starts_at: at('10:00'), ends_at: at('11:00') }]
    expect(freeSlots('2026-11-03', 'd1', [at('08:30'), at('09:15')], away, early, 4)).toEqual([at('08:00'), at('11:00'), at('11:30'), at('12:00')])
  })
  it('starts after now on the same day, and away periods of other doctors do not count', () => {
    const away = [{ doctor_id: 'd2', starts_at: at('00:00'), ends_at: at('23:59') }]
    expect(freeSlots('2026-11-03', 'd1', [], away, new Date(at('20:40')).getTime())).toEqual([at('21:00'), at('21:30')])
  })
})

describe('free times over the whole day (H53)', () => {
  it('reaches the evening on an empty day', () => {
    const slots = freeSlots('2026-11-03', 'd1', [], [], new Date('2026-11-03T00:00:00+03:00').getTime())
    expect(slots).toHaveLength(28)
    expect(slots.at(-1)).toBe(clinicTimeToIso('2026-11-03', '21:30'))
  })
  it('sorts times into parts of the clinic day', () => {
    expect(slotPeriod(clinicTimeToIso('2026-11-03', '11:30'))).toBe('morning')
    expect(slotPeriod(clinicTimeToIso('2026-11-03', '12:00'))).toBe('afternoon')
    expect(slotPeriod(clinicTimeToIso('2026-11-03', '16:30'))).toBe('afternoon')
    expect(slotPeriod(clinicTimeToIso('2026-11-03', '17:00'))).toBe('evening')
  })
})
