import type { TranslationKey } from './i18n/translations'

export const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'completed', 'cancelled'] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  requested: 'status.requested',
  confirmed: 'status.confirmed',
  completed: 'status.completed',
  cancelled: 'status.cancelled',
}
