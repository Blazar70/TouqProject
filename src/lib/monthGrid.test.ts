import { describe, expect, it } from 'vitest'
import { monthGrid } from './monthGrid'

describe('monthGrid', () => {
  it('starts on the Sunday before the 1st and covers 42 days', () => {
    const days = monthGrid(new Date(2026, 9, 20)) // October 2026 starts on a Thursday
    expect(days).toHaveLength(42)
    expect(days[0]).toEqual(new Date(2026, 8, 27)) // Sun 27 Sep
    expect(days[4]).toEqual(new Date(2026, 9, 1))
    expect(days[41]).toEqual(new Date(2026, 10, 7))
  })

  it('starts on the 1st when the month begins on a Sunday', () => {
    expect(monthGrid(new Date(2026, 1, 10))[0]).toEqual(new Date(2026, 1, 1)) // Feb 2026
  })
})
