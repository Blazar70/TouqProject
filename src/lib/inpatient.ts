import type { TranslationKey } from './i18n/translations'
import { clinicDay, formatDate, formatTime } from './format'

export const INPATIENT_MEDIA_BUCKET = 'inpatient-media'
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024
// A dose not ticked 15 minutes after its time shows as overdue (one push-job tick).
export const OVERDUE_AFTER_MS = 15 * 60_000

type T = (key: TranslationKey, vars?: Record<string, string>) => string
type UpdateLike = {
  created_at: string
  note: string | null
  weight_kg: number | null
  temperature_c: number | null
  heart_rate: number | null
  media: string[]
}

// Day 1 = the admission day (clinic days, not 24-hour blocks).
export function stayDay(admittedAt: string, now: Date = new Date()) {
  return Math.round((Date.parse(clinicDay(now)) - Date.parse(clinicDay(admittedAt))) / 86_400_000) + 1
}

// Nights billed for a stay (0086): clinic days crossed between admit and discharge; a same-day stay is 1.
export const stayNights = (admittedAt: string, dischargedAt: string) => Math.max(1, stayDay(admittedAt, new Date(dischargedAt)) - 1)

export const isVideo =(path: string) => /\.(mp4|mov|webm)$/i.test(path)

// "Copy as text": today's updates as a message reception can paste to the owner (WhatsApp etc.).
// Media can't travel in text, so it is only counted.
export function inpatientMessage(t: T, petName: string, updates: UpdateLike[], day: string = clinicDay()) {
  const lines = updates
    .filter((u) => clinicDay(u.created_at) === day)
    .map((u) => {
      const vitals = [
        u.temperature_c != null && t('inpatient.tempShort', { value: String(u.temperature_c) }),
        u.heart_rate != null && t('inpatient.hrShort', { value: String(u.heart_rate) }),
        u.weight_kg != null && t('inpatient.weightShort', { value: String(u.weight_kg) }),
      ].filter(Boolean)
      const parts = [u.note?.trim(), vitals.length > 0 && vitals.join(' · '), u.media.length > 0 && t('inpatient.mediaCount', { count: String(u.media.length) })]
      return `${formatTime(u.created_at)} - ${parts.filter(Boolean).join(' · ')}`
    })
  if (lines.length === 0) return null
  return [t('inpatient.messageHeader', { pet: petName, date: formatDate(`${day}T12:00:00+03:00`) }), ...lines].join('\n')
}
