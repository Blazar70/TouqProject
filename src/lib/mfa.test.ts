import { describe, expect, it } from 'vitest'
import { mfaRequired, mfaStep } from './mfa'

describe('mfaStep', () => {
  it('lets a code-verified session through', () => {
    expect(mfaStep({ currentLevel: 'aal2', nextLevel: 'aal2' }, true)).toBeNull()
  })
  it('asks for a code when a factor exists, required or not', () => {
    expect(mfaStep({ currentLevel: 'aal1', nextLevel: 'aal2' }, false)).toBe('verify')
    expect(mfaStep({ currentLevel: 'aal1', nextLevel: 'aal2' }, true)).toBe('verify')
  })
  it('forces set-up only for required roles', () => {
    expect(mfaStep({ currentLevel: 'aal1', nextLevel: 'aal1' }, true)).toBe('enroll')
    expect(mfaStep({ currentLevel: 'aal1', nextLevel: 'aal1' }, false)).toBeNull()
  })
})

describe('mfaRequired', () => {
  it('is admins and managers only', () => {
    expect(mfaRequired({ role: 'admin', clinic_role: null })).toBe(true)
    expect(mfaRequired({ role: 'vet', clinic_role: 'manager' })).toBe(true)
    expect(mfaRequired({ role: 'vet', clinic_role: 'receptionist' })).toBe(false)
  })
})
