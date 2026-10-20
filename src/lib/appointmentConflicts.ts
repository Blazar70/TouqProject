// Two appointments are worth flagging as a conflict if they involve the
// same pet or the same doctor and fall within half an hour of each
// other — close enough that double-booking was probably unintentional,
// without blocking legitimately back-to-back or same-day-different-time
// scheduling.
export const CONFLICT_WINDOW_MS = 30 * 60 * 1000

export type ConflictCandidate = {
  petId: string
  doctorId: string
  scheduledAt: string
  excludeAppointmentId?: string
}

export type ConflictableAppointment = {
  id: string
  pet_id: string
  doctor_id: string | null
  scheduled_at: string
  status: string
}

export function findAppointmentConflicts<T extends ConflictableAppointment>(
  appointments: T[],
  candidate: ConflictCandidate,
): T[] {
  const candidateTime = new Date(candidate.scheduledAt).getTime()

  return appointments.filter((a) => {
    if (a.status === 'cancelled') return false
    if (a.id === candidate.excludeAppointmentId) return false

    const samePet = a.pet_id === candidate.petId
    const sameDoctor = Boolean(candidate.doctorId) && a.doctor_id === candidate.doctorId
    if (!samePet && !sameDoctor) return false

    return Math.abs(new Date(a.scheduled_at).getTime() - candidateTime) < CONFLICT_WINDOW_MS
  })
}
