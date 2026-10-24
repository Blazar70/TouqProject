import { describe, expect, it } from 'vitest'
import { inpatientMessage, isVideo, stayDay } from './inpatient'

// Echoes the key and its values, so the test doesn't depend on the wording.
const t = (key: string, vars?: Record<string, string>) => `${key}${vars ? `(${Object.values(vars).join(',')})` : ''}`
const update = (at: string, extra: Partial<Parameters<typeof inpatientMessage>[2][number]> = {}) => ({
  created_at: at,
  note: null,
  weight_kg: null,
  temperature_c: null,
  heart_rate: null,
  media: [],
  ...extra,
})

describe('stayDay', () => {
  it('counts clinic days from admission, starting at 1', () => {
    expect(stayDay('2026-10-24T05:00:00Z', new Date('2026-10-24T20:00:00Z'))).toBe(1)
    // 22:30 Riyadh on the 24th is already the 25th's clinic day after 21:00Z.
    expect(stayDay('2026-10-24T05:00:00Z', new Date('2026-10-24T21:30:00Z'))).toBe(2)
    expect(stayDay('2026-10-20T10:00:00Z', new Date('2026-10-24T10:00:00Z'))).toBe(5)
  })
})

describe('inpatientMessage', () => {
  it("lists only that clinic day's updates, with vitals and a media count", () => {
    const text = inpatientMessage(t, 'Max', [
      update('2026-10-23T08:00:00Z', { note: 'yesterday' }),
      update('2026-10-24T06:00:00Z', { note: ' Ate well ', temperature_c: 38.6, heart_rate: 110 }),
      update('2026-10-24T09:00:00Z', { weight_kg: 4.2, media: ['a.jpg', 'b.mp4'] }),
    ], '2026-10-24')!
    const lines = text.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^inpatient\.messageHeader\(Max,/)
    expect(lines[1]).toMatch(/ - Ate well · inpatient\.tempShort\(38\.6\) · inpatient\.hrShort\(110\)$/)
    expect(lines[2]).toMatch(/ - inpatient\.weightShort\(4\.2\) · inpatient\.mediaCount\(2\)$/)
    expect(text).not.toContain('yesterday')
  })
  it('returns null when nothing was recorded that day', () => {
    expect(inpatientMessage(t, 'Max', [update('2026-10-23T08:00:00Z', { note: 'x' })], '2026-10-24')).toBeNull()
  })
})

describe('isVideo', () => {
  it('tells videos from photos by extension', () => {
    expect(isVideo('c/p/s/x.MOV')).toBe(true)
    expect(isVideo('c/p/s/x.jpg')).toBe(false)
  })
})
