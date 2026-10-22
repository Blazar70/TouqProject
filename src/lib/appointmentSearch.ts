import { formatDate } from './format'

type SearchablePet = { name: string; owner_phone: string | null; pet_number: number }

type SearchableAppointment = {
  scheduled_at: string
  pets: SearchablePet | null
  doctor: { full_name: string } | null
}

// Pet name, owner phone or Pet ID (substring). Shared by every pet search box.
export function matchesPetSearch(pet: SearchablePet, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  // Phones are stored as +9665…; a local "05…" or spaced number still matches on its digits.
  const digits = normalized.replace(/[\s+-]/g, '')
  const localDigits = /^\d{3,}$/.test(digits) ? digits.replace(/^0+/, '') : ''
  return (
    pet.name.toLowerCase().includes(normalized) ||
    (pet.owner_phone ?? '').toLowerCase().includes(normalized) ||
    (localDigits !== '' && (pet.owner_phone ?? '').replace(/\D/g, '').includes(localDigits)) ||
    String(pet.pet_number).includes(normalized)
  )
}

// Matches on the pet (see matchesPetSearch), staff name (substring), or on date —
// the highest specificity supported for date is day, matched against either
// the ISO date or the viewer's locale date format so both "2026-07-23" and
// "7/23/2026" style queries work, plus the app's own display format ("Jul 23").
export function matchesAppointmentSearch(appointment: SearchableAppointment, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  const scheduled = new Date(appointment.scheduled_at)
  return (
    (appointment.pets ? matchesPetSearch(appointment.pets, normalized) : false) ||
    (appointment.doctor?.full_name ?? '').toLowerCase().includes(normalized) ||
    scheduled.toISOString().slice(0, 10).includes(normalized) ||
    scheduled.toLocaleDateString().toLowerCase().includes(normalized) ||
    formatDate(scheduled).toLowerCase().includes(normalized)
  )
}
