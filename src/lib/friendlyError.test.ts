import { describe, expect, it } from 'vitest'
import { friendlyErrorKey } from './friendlyError'

describe('friendlyErrorKey', () => {
  it('maps network, login and wrapped DB errors', () => {
    expect(friendlyErrorKey('TypeError: Failed to fetch')).toBe('errors.offline')
    expect(friendlyErrorKey('Invalid login credentials')).toBe('errors.invalidLogin')
    expect(friendlyErrorKey("Couldn't save: A discount needs a reason")).toBe('errors.needsReason')
    expect(friendlyErrorKey('Not enough balance (available 40.00)')).toBe('errors.notEnoughBalance')
  })
  it('leaves unknown messages alone', () => {
    expect(friendlyErrorKey('something else')).toBeNull()
  })
})
