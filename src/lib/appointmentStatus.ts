import type { TranslationKey } from './i18n/translations'

export const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'arrived', 'in_session', 'completed', 'cancelled'] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  requested: 'status.requested',
  confirmed: 'status.confirmed',
  arrived: 'status.arrived',
  in_session: 'status.in_session',
  completed: 'status.completed',
  cancelled: 'status.cancelled',
}

// Same rule as can_work_session (0075): only doctors and nurses run sessions; a running one
// belongs to whoever started it, plus clinicians of the other role (doctor + nurse share a visit).
export function canWorkSession(role: string | null | undefined, userId: string | undefined, startedBy: string | null, starterRole: string | null | undefined) {
  if (role !== 'doctor' && role !== 'nurse') return false
  return !startedBy || startedBy === userId || starterRole !== role
}

// Dashboard "Next": the pet waiting longest (earliest slot among arrived; there is no arrived_at),
// else the next booked slot still to come. Arrived pets count even when their slot has passed (H12).
export function nextAppointmentId(appointments: { id: string; status: string; scheduled_at: string }[], now: number) {
  const byTime = [...appointments].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))
  return (
    byTime.find((a) => a.status === 'arrived') ??
    byTime.find((a) => (a.status === 'requested' || a.status === 'confirmed') && Date.parse(a.scheduled_at) >= now)
  )?.id
}
