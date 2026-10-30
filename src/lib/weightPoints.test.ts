import { describe, expect, it } from 'vitest'
import { weightChange, weightPoints } from './weightPoints'

describe('weightPoints', () => {
  it('merges both sources oldest first and drops empty weights', () => {
    const points = weightPoints(
      [
        { visit_date: '2026-10-20T09:00:00Z', weight_kg: 4.5 },
        { visit_date: '2026-10-01T09:00:00Z', weight_kg: null },
      ],
      [{ created_at: '2026-10-10T09:00:00Z', weight_kg: 4.2 }],
    )
    expect(points).toEqual([
      { at: '2026-10-10T09:00:00Z', kg: 4.2 },
      { at: '2026-10-20T09:00:00Z', kg: 4.5 },
    ])
  })
})

describe('weightChange', () => {
  const pts = (...kgs: number[]) => kgs.map((kg, i) => ({ at: `2026-0${i + 1}-01T00:00:00Z`, kg }))
  it('flags an adult change over 10% either way, in kg and %', () => {
    expect(weightChange(pts(5, 5.5, 4.4), '2020-01-01')).toEqual({ kg: -1.1, pct: -20, flag: true })
    expect(weightChange(pts(5, 5.6), '2020-01-01')).toEqual({ kg: 0.6, pct: 12, flag: true })
    expect(weightChange(pts(5, 5.4), '2020-01-01')?.flag).toBe(false)
  })
  it('does not flag a growing puppy, but does flag its weight loss', () => {
    expect(weightChange(pts(2, 3), '2025-11-01')?.flag).toBe(false)
    expect(weightChange(pts(3, 2.5), '2025-11-01')?.flag).toBe(true)
  })
  it('treats unknown age with a short history as young', () => {
    expect(weightChange(pts(2, 3), null)?.flag).toBe(false)
    expect(weightChange(pts(2, 2, 3), null)?.flag).toBe(true)
    expect(weightChange(pts(2), null)).toBeNull()
  })
})
