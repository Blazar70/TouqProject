import type { TranslationKey } from './i18n/translations'

// Stored in English regardless of UI language, same pattern as visit_type —
// lets the dashboard group cancellations by category for reporting instead
// of only having free-text reasons to sift through.
export const CANCELLATION_CATEGORIES = [
  'owner_cancelled',
  'vet_unavailable',
  'pet_unwell',
  'rescheduled',
  'no_show',
  'other',
] as const

export type CancellationCategory = (typeof CANCELLATION_CATEGORIES)[number]

const CANCELLATION_CATEGORY_LABEL_KEYS: Record<CancellationCategory, TranslationKey> = {
  owner_cancelled: 'cancellation.ownerCancelled',
  vet_unavailable: 'cancellation.vetUnavailable',
  pet_unwell: 'cancellation.petUnwell',
  rescheduled: 'cancellation.rescheduled',
  no_show: 'cancellation.noShow',
  other: 'cancellation.other',
}

export function cancellationCategoryLabel(t: (key: TranslationKey) => string, category: string): string {
  return t((CANCELLATION_CATEGORY_LABEL_KEYS as Record<string, TranslationKey>)[category] ?? 'cancellation.other')
}

// Older cancellations (from before this column existed) have a null
// category — bucket those under "other" rather than dropping them from the
// count. Returns only categories that actually occurred, in a fixed display
// order, so the dashboard doesn't show a row of zeroes.
export function groupCancellationCounts(categories: (string | null)[]): { category: CancellationCategory; count: number }[] {
  const counts = new Map<string, number>()
  for (const raw of categories) {
    const key = raw ?? 'other'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return CANCELLATION_CATEGORIES.filter((category) => counts.has(category)).map((category) => ({
    category,
    count: counts.get(category)!,
  }))
}
