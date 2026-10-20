import { describe, expect, it } from 'vitest'
import { CANCELLATION_CATEGORIES, cancellationCategoryLabel, groupCancellationCounts } from './cancellation'

describe('cancellationCategoryLabel', () => {
  it('translates a known category', () => {
    const t = (key: string) => `translated:${key}`
    expect(cancellationCategoryLabel(t, 'no_show')).toBe('translated:cancellation.noShow')
  })

  it('falls back to "other" for an unknown/missing category', () => {
    const t = (key: string) => `translated:${key}`
    expect(cancellationCategoryLabel(t, 'something_unexpected')).toBe('translated:cancellation.other')
  })
})

describe('CANCELLATION_CATEGORIES', () => {
  it('no longer offers "rescheduled" but still labels and counts old rows with it', () => {
    const t = (key: string) => `translated:${key}`
    expect(CANCELLATION_CATEGORIES).not.toContain('rescheduled')
    expect(cancellationCategoryLabel(t, 'rescheduled')).toBe('translated:cancellation.rescheduled')
    expect(groupCancellationCounts(['rescheduled'])).toEqual([{ category: 'rescheduled', count: 1 }])
  })
})

describe('groupCancellationCounts', () => {
  it('counts occurrences per category', () => {
    const result = groupCancellationCounts(['no_show', 'no_show', 'owner_cancelled'])
    expect(result).toEqual([
      { category: 'owner_cancelled', count: 1 },
      { category: 'no_show', count: 2 },
    ])
  })

  it('buckets a null (legacy) category under "other"', () => {
    const result = groupCancellationCounts([null, null])
    expect(result).toEqual([{ category: 'other', count: 2 }])
  })

  it('returns an empty array for no cancellations', () => {
    expect(groupCancellationCounts([])).toEqual([])
  })
})
