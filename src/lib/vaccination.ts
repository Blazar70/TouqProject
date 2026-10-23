import type { TranslationKey } from './i18n/translations'
import { clinicDay } from './format'

export type VaccinationStatus = 'none' | 'ok' | 'due-soon' | 'overdue'

export const DUE_SOON_WINDOW_DAYS = 14

// yyyy-mm-dd + n days. Both are calendar days, so UTC arithmetic is exact.
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10)
}

// Compared with the clinic's calendar day, not the device clock or UTC (U26).
export function vaccinationStatus(nextDate: string | null, today: string = clinicDay()): VaccinationStatus {
  if (!nextDate) return 'none'
  const daysUntil = (Date.parse(nextDate) - Date.parse(today)) / 86_400_000
  if (daysUntil < 0) return 'overdue'
  if (daysUntil <= DUE_SOON_WINDOW_DAYS) return 'due-soon'
  return 'ok'
}

const VACCINATION_STATUS_KEYS: Record<VaccinationStatus, TranslationKey> = {
  none: 'vaccination.statusNone',
  ok: 'vaccination.statusOk',
  'due-soon': 'vaccination.statusDueSoon',
  overdue: 'vaccination.statusOverdue',
}

export function vaccinationStatusLabel(t: (key: TranslationKey) => string, status: VaccinationStatus): string {
  return t(VACCINATION_STATUS_KEYS[status])
}
