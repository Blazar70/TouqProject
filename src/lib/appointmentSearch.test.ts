import { describe, expect, it } from 'vitest'
import { matchesAppointmentSearch, matchesPetSearch } from './appointmentSearch'

const appointment = {
  scheduled_at: '2026-07-23T12:30:00.000Z',
  pets: { name: 'Rex', owner_phone: '+966512345678', pet_number: 10042 },
  doctor: { full_name: 'Dr. Amal' },
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

  it('matches by Pet ID', () => {
    expect(matchesAppointmentSearch(appointment, '10042')).toBe(true)
    expect(matchesAppointmentSearch(appointment, '10043')).toBe(false)
  })

  it('matches by ISO date', () => {
    expect(matchesAppointmentSearch(appointment, '2026-07-23')).toBe(true)
  })

  it('matches the date as the app displays it', () => {
    expect(matchesAppointmentSearch(appointment, 'jul 23')).toBe(true)
  })

  it('does not match an unrelated query', () => {
    expect(matchesAppointmentSearch(appointment, 'nonexistent')).toBe(false)
  })

  it('handles a null pet or staff gracefully', () => {
    const bare = { scheduled_at: '2026-07-23T12:30:00.000Z', pets: null, doctor: null }
    expect(matchesAppointmentSearch(bare, 'rex')).toBe(false)
    expect(matchesAppointmentSearch(bare, '')).toBe(true)
  })
})

describe('matchesPetSearch', () => {
  const pet = { name: 'Luna', owner_phone: null, pet_number: 10001 }

  it('matches by name or Pet ID, not by unrelated text', () => {
    expect(matchesPetSearch(pet, ' LUNA ')).toBe(true)
    expect(matchesPetSearch(pet, '10001')).toBe(true)
    expect(matchesPetSearch(pet, '20001')).toBe(false)
  })
})
