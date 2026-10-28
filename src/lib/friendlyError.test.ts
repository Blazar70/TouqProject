import { describe, expect, it } from 'vitest'
import { friendlyErrorKey } from './friendlyError'

describe('friendlyErrorKey', () => {
  it('maps network, login and wrapped DB errors', () => {
    expect(friendlyErrorKey('TypeError: Failed to fetch')).toBe('errors.offline')
    expect(friendlyErrorKey('Invalid login credentials')).toBe('errors.invalidLogin')
    expect(friendlyErrorKey('Email address not authorized')).toBe('errors.resetEmailFailed')
    expect(friendlyErrorKey('email rate limit exceeded')).toBe('errors.resetEmailFailed')
    expect(friendlyErrorKey('Email rate limit exceeded')).toBe('errors.resetEmailFailed')
    expect(friendlyErrorKey("Couldn't save: A discount needs a reason")).toBe('errors.needsReason')
    expect(friendlyErrorKey('Not enough balance (available 40.00)')).toBe('errors.notEnoughBalance')
    // 0074/0076 raise these through require_clinic_role(), out of sight of the scan below.
    expect(friendlyErrorKey('Only receptionists and managers handle money')).toBe('errors.moneyRole')
    expect(friendlyErrorKey('Only managers can see income and VAT reports')).toBe('errors.managerReport')
    expect(friendlyErrorKey('Only receptionists and managers can merge owners or move pets')).toBe('errors.ownerMoveRole')
  })
  it('leaves unknown messages alone', () => {
    expect(friendlyErrorKey('something else')).toBeNull()
  })
})

describe('every staff-rule error has a friendly text', () => {
  it('maps each message staffRules.ts returns', () => {
    const src = import.meta.glob('../../supabase/functions/_shared/staffRules.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const messages = Object.values(src).flatMap((text) => [...text.matchAll(/return '([^']+)'/g)].map((m) => m[1]))
    expect(messages.length).toBeGreaterThan(4)
    expect(messages.filter((m) => !friendlyErrorKey(m))).toEqual([])
  })
})

describe('every database error has a friendly text', () => {
  it('maps each raise exception message in the migrations', () => {
    const sql = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const messages = Object.values(sql)
      .flatMap((text) => [...text.matchAll(/raise exception '((?:[^']|'')+)'/g)])
      .map((m) => m[1].replace(/''/g, "'"))
    expect(messages.length).toBeGreaterThan(30)
    // A new raise in a migration needs a line in friendlyError.ts.
    expect(messages.filter((m) => !friendlyErrorKey(m))).toEqual([])
  })
})
