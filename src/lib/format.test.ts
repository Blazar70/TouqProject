import { describe, expect, it } from 'vitest'
import { clinicDay, formatDate, formatDateTime, formatIsoDate, formatMoney, setDisplayLanguage } from './format'

describe('format', () => {
  it('gives the clinic day in Riyadh time, whatever the device zone', () => {
    expect(clinicDay('2026-10-19T20:59:30Z')).toBe('2026-10-19')
    expect(clinicDay('2026-10-19T21:00:30Z')).toBe('2026-10-20')
  })

  it('formats dates with a month name', () => {
    expect(formatDate(new Date(2026, 8, 21, 15, 30))).toBe('Sep 21, 2026')
  })

  it('reads a bare yyyy-mm-dd as that calendar day, not UTC midnight', () => {
    expect(formatDate('2026-09-21')).toBe('Sep 21, 2026')
    expect(formatIsoDate('2026-09-21')).toBe('2026-09-21')
  })

  it('formats date and time in 12-hour form', () => {
    expect(formatDateTime(new Date(2026, 9, 20, 16, 5))).toBe('Oct 20, 2026, 4:05 PM')
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
})
