import { describe, expect, it } from 'vitest'
import { addDays, vaccinationStatus } from './vaccination'

const TODAY = '2026-10-23'

describe('vaccinationStatus', () => {
  it('returns "none" when there is no next date', () => {
    expect(vaccinationStatus(null, TODAY)).toBe('none')
  })

  it('returns "overdue" for a day before today', () => {
    expect(vaccinationStatus('2026-10-22', TODAY)).toBe('overdue')
    expect(vaccinationStatus('2026-09-23', TODAY)).toBe('overdue')
  })

  it('returns "due-soon" from today through the 14-day window', () => {
    expect(vaccinationStatus(TODAY, TODAY)).toBe('due-soon')
    expect(vaccinationStatus('2026-11-06', TODAY)).toBe('due-soon')
  })

  it('returns "ok" beyond the 14-day window', () => {
    expect(vaccinationStatus('2026-11-07', TODAY)).toBe('ok')
  })
})

describe('addDays', () => {
  it('adds calendar days across months and years', () => {
    expect(addDays('2026-10-23', 14)).toBe('2026-11-06')
    expect(addDays('2026-12-25', 365)).toBe('2027-12-25')
  })
})
