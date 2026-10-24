import { describe, expect, it } from 'vitest'
import { canWorkSession, nextAppointmentId } from './appointmentStatus'

describe('canWorkSession', () => {
  it('lets only doctors and nurses in', () => {
    expect(canWorkSession('receptionist', 'r', null, null)).toBe(false)
    expect(canWorkSession('manager', 'm', 'd1', 'doctor')).toBe(false)
    expect(canWorkSession('doctor', 'd1', null, null)).toBe(true)
  })
  it('keeps a running session to its starter and the other role', () => {
    expect(canWorkSession('doctor', 'd1', 'd1', 'doctor')).toBe(true)
    expect(canWorkSession('doctor', 'd2', 'd1', 'doctor')).toBe(false)
    expect(canWorkSession('nurse', 'n', 'd1', 'doctor')).toBe(true)
    expect(canWorkSession('doctor', 'd2', 'n', 'nurse')).toBe(true)
  })
})

describe('nextAppointmentId', () => {
  const now = Date.parse('2026-10-24T10:00:00Z')
  const at = (id: string, status: string, time: string) => ({ id, status, scheduled_at: `2026-10-24T${time}:00Z` })

  it('puts the longest-waiting arrived pet first, even when its slot has passed', () => {
    const list = [at('late', 'confirmed', '09:00'), at('up', 'confirmed', '10:30'), at('a2', 'arrived', '09:45'), at('a1', 'arrived', '09:15')]
    expect(nextAppointmentId(list, now)).toBe('a1')
  })
  it('else picks the next booked slot still to come', () => {
    const list = [at('late', 'requested', '09:00'), at('s', 'in_session', '09:30'), at('x', 'cancelled', '10:15'), at('up', 'requested', '10:30')]
    expect(nextAppointmentId(list, now)).toBe('up')
    expect(nextAppointmentId([at('done', 'completed', '11:00')], now)).toBeUndefined()
  })
})
