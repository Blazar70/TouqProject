import { describe, expect, it } from 'vitest'
import { vaccinationStatus, nextVaccinationDateAfterDose } from './vaccination'

function daysFromNow(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('vaccinationStatus', () => {
  it('returns "none" when there is no next date', () => {
    expect(vaccinationStatus(null)).toBe('none')
  })

  it('returns "overdue" for a date in the past', () => {
    expect(vaccinationStatus(daysFromNow(-1))).toBe('overdue')
    expect(vaccinationStatus(daysFromNow(-30))).toBe('overdue')
  })

  it('returns "due-soon" within the 14-day window', () => {
    expect(vaccinationStatus(daysFromNow(0))).toBe('due-soon')
    expect(vaccinationStatus(daysFromNow(14))).toBe('due-soon')
  })

  it('returns "ok" beyond the 14-day window', () => {
    expect(vaccinationStatus(daysFromNow(15))).toBe('ok')
    expect(vaccinationStatus(daysFromNow(365))).toBe('ok')
  })
})

describe('nextVaccinationDateAfterDose', () => {
  it('returns today + the interval, as YYYY-MM-DD', () => {
    expect(nextVaccinationDateAfterDose(30)).toBe(daysFromNow(30))
  })

  it('marking the result due-soon or later, never overdue', () => {
    const status = vaccinationStatus(nextVaccinationDateAfterDose(30))
    expect(status === 'due-soon' || status === 'ok').toBe(true)
  })
})
