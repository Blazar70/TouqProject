import type { TranslationKey } from './i18n/translations'

export const VISIT_TYPES = ['checkup', 'vaccination', 'surgery', 'emergency', 'follow_up', 'grooming', 'other'] as const

// visit_type values are stored in English; this maps a value to its
// translated display label.
export function visitTypeLabel(t: (key: TranslationKey) => string, visitType: string): string {
  return t(`visitType.${visitType}` as TranslationKey)
}
