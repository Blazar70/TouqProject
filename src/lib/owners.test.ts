import { describe, expect, it } from 'vitest'
import { balancesAfter } from './owners'

describe('balancesAfter', () => {
  it('walks back from the current balance', () => {
    // top-up 200, pay 150, refund 50 (oldest first) -> balance 100
    expect(balancesAfter(100, [50, -150, 200])).toEqual([100, 50, 200])
  })
})
