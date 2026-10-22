import { describe, expect, it } from 'vitest'
import { balancesAfter, matchesOwner } from './owners'

describe('matchesOwner', () => {
  const owner = { name: 'Noura Al-Qahtani', phone: '+966501234501' }
  it('finds by name or by phone in any form', () => {
    expect(matchesOwner(owner, 'noura')).toBe(true)
    expect(matchesOwner(owner, '0501234501')).toBe(true)
    expect(matchesOwner(owner, '4501')).toBe(true)
    expect(matchesOwner(owner, 'faisal')).toBe(false)
    expect(matchesOwner({ name: 'X', phone: null }, '050')).toBe(false)
  })
})

describe('balancesAfter', () => {
  it('walks back from the current balance', () => {
    // top-up 200, pay 150, refund 50 (oldest first) -> balance 100
    expect(balancesAfter(100, [50, -150, 200])).toEqual([100, 50, 200])
  })
})
