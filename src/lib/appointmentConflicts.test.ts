import { describe, expect, it } from 'vitest'
import { findAppointmentConflicts } from './appointmentConflicts'

const existing = [
  { id: 'a1', pet_id: 'pet-1', assigned_staff_id: 'staff-1', scheduled_at: '2026-07-23T10:00:00.000Z', status: 'confirmed' },
  { id: 'a2', pet_id: 'pet-2', assigned_staff_id: 'staff-2', scheduled_at: '2026-07-23T14:00:00.000Z', status: 'cancelled' },
]

describe('findAppointmentConflicts', () => {
  it('flags a conflict for the same pet within the time window', () => {
    const conflicts = findAppointmentConflicts(existing, {
      petId: 'pet-1',
      assignedStaffId: 'staff-9',
      scheduledAt: '2026-07-23T10:15:00.000Z',
    })
    expect(conflicts.map((c) => c.id)).toEqual(['a1'])
  })

  it('flags a conflict for the same staff member within the time window', () => {
    const conflicts = findAppointmentConflicts(existing, {
      petId: 'pet-9',
      assignedStaffId: 'staff-1',
      scheduledAt: '2026-07-23T10:20:00.000Z',
    })
    expect(conflicts.map((c) => c.id)).toEqual(['a1'])
  })

  it('does not flag appointments outside the conflict window', () => {
    const conflicts = findAppointmentConflicts(existing, {
      petId: 'pet-1',
      assignedStaffId: 'staff-1',
      scheduledAt: '2026-07-23T11:00:00.000Z',
    })
    expect(conflicts).toEqual([])
  })

  it('ignores cancelled appointments', () => {
    const conflicts = findAppointmentConflicts(existing, {
      petId: 'pet-2',
      assignedStaffId: 'staff-2',
      scheduledAt: '2026-07-23T14:00:00.000Z',
    })
    expect(conflicts).toEqual([])
  })

  it('excludes an appointment by id (e.g. when editing itself)', () => {
    const conflicts = findAppointmentConflicts(existing, {
      petId: 'pet-1',
      assignedStaffId: 'staff-1',
      scheduledAt: '2026-07-23T10:00:00.000Z',
      excludeAppointmentId: 'a1',
    })
    expect(conflicts).toEqual([])
  })
})
