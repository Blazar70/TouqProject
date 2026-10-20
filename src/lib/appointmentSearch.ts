import { formatDate } from './format'

type SearchableAppointment = {
  scheduled_at: string
  pets: { name: string; owner_phone: string | null } | null
  doctor: { full_name: string } | null
}

// Matches on pet name, staff name, or owner phone (substring), or on date —
// the highest specificity supported for date is day, matched against either
// the ISO date or the viewer's locale date format so both "2026-07-23" and
// "7/23/2026" style queries work, plus the app's own display format ("Jul 23").
export function matchesAppointmentSearch(appointment: SearchableAppointment, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  const scheduled = new Date(appointment.scheduled_at)
  return (
    (appointment.pets?.name ?? '').toLowerCase().includes(normalized) ||
    (appointment.doctor?.full_name ?? '').toLowerCase().includes(normalized) ||
    (appointment.pets?.owner_phone ?? '').toLowerCase().includes(normalized) ||
    scheduled.toISOString().slice(0, 10).includes(normalized) ||
    scheduled.toLocaleDateString().toLowerCase().includes(normalized) ||
    formatDate(scheduled).toLowerCase().includes(normalized)
  )
}
