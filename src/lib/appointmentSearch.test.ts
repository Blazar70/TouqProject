import { describe, expect, it } from 'vitest'
import { matchesAppointmentSearch } from './appointmentSearch'

const appointment = {
  scheduled_at: '2026-07-23T12:30:00.000Z',
  pets: { name: 'Rex', owner_phone: '+966512345678' },
  caregivers: { name: 'Dr. Amal' },
}

describe('matchesAppointmentSearch', () => {
  it('matches everything when the query is empty', () => {
    expect(matchesAppointmentSearch(appointment, '')).toBe(true)
    expect(matchesAppointmentSearch(appointment, '   ')).toBe(true)
  })

  it('matches by pet name, case-insensitively', () => {
    expect(matchesAppointmentSearch(appointment, 'rex')).toBe(true)
    expect(matchesAppointmentSearch(appointment, 'REX')).toBe(true)
  })

  it('matches by staff name', () => {
    expect(matchesAppointmentSearch(appointment, 'amal')).toBe(true)
  })

  it('matches by owner phone substring', () => {
    expect(matchesAppointmentSearch(appointment, '512345')).toBe(true)
  })

  it('matches by ISO date', () => {
    expect(matchesAppointmentSearch(appointment, '2026-07-23')).toBe(true)
  })

  it('does not match an unrelated query', () => {
    expect(matchesAppointmentSearch(appointment, 'nonexistent')).toBe(false)
  })

  it('handles a null pet or staff gracefully', () => {
    const bare = { scheduled_at: '2026-07-23T12:30:00.000Z', pets: null, caregivers: null }
    expect(matchesAppointmentSearch(bare, 'rex')).toBe(false)
    expect(matchesAppointmentSearch(bare, '')).toBe(true)
  })
})
