import { describe, expect, it } from 'vitest'
import { canWorkSession } from './appointmentStatus'

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
