import { describe, expect, it, vi } from 'vitest'
import { clinicDay, dobFromAge, formatDate, formatDateTime, formatIsoDate, formatMoney, setDisplayLanguage, clinicMidnight, upcomingGroup } from './format'

describe('format', () => {
  it('gives the clinic day in Riyadh time, whatever the device zone', () => {
    expect(clinicDay('2026-10-19T20:59:30Z')).toBe('2026-10-19')
    expect(clinicDay('2026-10-19T21:00:30Z')).toBe('2026-10-20')
  })

  it('formats dates with a month name', () => {
    expect(formatDate(new Date('2026-09-21T15:30:00+03:00'))).toBe('Sep 21, 2026')
  })

  it('shows dates and times in Riyadh time, whatever the device zone (B4)', () => {
    vi.stubEnv('TZ', 'America/New_York')
    try {
      // 22:30 UTC on the 24th is 01:30 on the 25th in Riyadh.
      expect(formatDateTime('2026-10-24T22:30:00Z')).toBe('Oct 25, 2026, 1:30 AM')
      expect(formatDate('2026-10-25')).toBe('Oct 25, 2026')
      expect(formatIsoDate('2026-10-25')).toBe('2026-10-25')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reads a bare yyyy-mm-dd as that calendar day, not UTC midnight', () => {
    expect(formatDate('2026-09-21')).toBe('Sep 21, 2026')
    expect(formatIsoDate('2026-09-21')).toBe('2026-09-21')
  })

  it('formats date and time in 12-hour form', () => {
    expect(formatDateTime(new Date('2026-10-20T16:05:00+03:00'))).toBe('Oct 20, 2026, 4:05 PM')
  })

  it('formats money with two decimals and thousands separators', () => {
    expect(formatMoney(1250)).toBe('1,250.00')
    expect(formatMoney(0)).toBe('0.00')
    expect(formatMoney(86.956)).toBe('86.96')
  })
  it('formats Arabic dates Gregorian with Latin digits', () => {
    setDisplayLanguage('ar')
    expect(formatDate('2026-10-23')).toBe('23 أكتوبر 2026')
    setDisplayLanguage('en')
    expect(formatDate('2026-10-23')).toBe('Oct 23, 2026')
  })
  it('clinic midnight is 21:00 UTC the day before', () => {
    expect(clinicMidnight('2026-10-23').toISOString()).toBe('2026-10-22T21:00:00.000Z')
  })
})

describe('upcomingGroup (H63)', () => {
  it('splits by clinic day: today, the next 7 days, later', () => {
    expect(upcomingGroup('2026-11-04T20:59:00Z', '2026-11-04')).toBe('today') // 23:59 in Riyadh
    expect(upcomingGroup('2026-11-04T21:00:00Z', '2026-11-04')).toBe('week') // 00:00 on the 5th
    expect(upcomingGroup('2026-11-10T12:00:00Z', '2026-11-04')).toBe('week')
    expect(upcomingGroup('2026-11-11T12:00:00Z', '2026-11-04')).toBe('later')
  })
})

describe('dobFromAge (H59)', () => {
  it('counts back years and months', () => {
    expect(dobFromAge(2, 0, '2026-11-04')).toBe('2024-11-04')
    expect(dobFromAge(0, 11, '2026-11-04')).toBe('2025-12-04')
    expect(dobFromAge(1, 3, '2026-02-15')).toBe('2024-11-15')
  })
  it('clamps to the end of a shorter month', () => {
    expect(dobFromAge(0, 1, '2026-03-31')).toBe('2026-02-28')
    expect(dobFromAge(2, 1, '2026-03-31')).toBe('2024-02-29')
  })
})
