import { describe, expect, it } from 'vitest'
import { weightPoints } from './weightPoints'

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
