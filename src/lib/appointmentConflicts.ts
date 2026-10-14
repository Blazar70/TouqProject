// Two appointments are worth flagging as a conflict if they involve the
// same pet or the same staff member and fall within half an hour of each
// other — close enough that double-booking was probably unintentional,
// without blocking legitimately back-to-back or same-day-different-time
// scheduling.
export const CONFLICT_WINDOW_MS = 30 * 60 * 1000

export type ConflictCandidate = {
  petId: string
  assignedStaffId: string
  scheduledAt: string
  excludeAppointmentId?: string
}

export type ConflictableAppointment = {
  id: string
  pet_id: string
  assigned_staff_id: string | null
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
    const sameStaff = Boolean(candidate.assignedStaffId) && a.assigned_staff_id === candidate.assignedStaffId
    if (!samePet && !sameStaff) return false

    return Math.abs(new Date(a.scheduled_at).getTime() - candidateTime) < CONFLICT_WINDOW_MS
  })
}
