import type { TranslationKey } from './i18n/translations'

export type VaccinationStatus = 'none' | 'ok' | 'due-soon' | 'overdue'

const DUE_SOON_WINDOW_DAYS = 14

export function vaccinationStatus(nextDate: string | null): VaccinationStatus {
  if (!nextDate) return 'none'
  const daysUntil = Math.ceil((new Date(nextDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
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

export const REPEAT_INTERVAL_OPTIONS: { labelKey: TranslationKey; days: number }[] = [
  { labelKey: 'vaccination.every30', days: 30 },
  { labelKey: 'vaccination.every90', days: 90 },
  { labelKey: 'vaccination.every6mo', days: 182 },
  { labelKey: 'vaccination.everyYear', days: 365 },
]

// The date a dose given "today" pushes the next one out to, as a
// YYYY-MM-DD string ready to store — shared by VaccinationPanel's own
// "mark given" action and the quick one-click version on the pets list.
export function nextVaccinationDateAfterDose(intervalDays: number): string {
  const next = new Date()
  next.setDate(next.getDate() + intervalDays)
  return next.toISOString().slice(0, 10)
}
