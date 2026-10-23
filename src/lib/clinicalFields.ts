import type { TranslationKey } from './i18n/translations'
import { toLatinDigits } from './arabicDigits'

// Same limits as the check constraints in
// supabase/migrations/0040_medical_record_clinical_fields.sql — keep in sync.
// Weight is exclusive at both ends; temperature and heart rate are inclusive.
export const WEIGHT_KG_MAX = 2000
export const TEMPERATURE_C_MIN = 25
export const TEMPERATURE_C_MAX = 45
export const HEART_RATE_BPM_MIN = 1
export const HEART_RATE_BPM_MAX = 400

export type VitalsInput = { weight: string; temperature: string; heartRate: string }

export type Vitals = {
  weight_kg: number | null
  temperature_c: number | null
  heart_rate_bpm: number | null
}

export type VitalsResult = { ok: true; vitals: Vitals } | { ok: false; errorKey: TranslationKey }

function normalizeNumber(raw: string): string {
  return toLatinDigits(raw.trim())
}

// undefined = invalid, null = left empty.
function parseNumber(raw: string, integerOnly: boolean): number | null | undefined {
  const value = normalizeNumber(raw)
  if (value === '') return null
  const pattern = integerOnly ? /^\d+$/ : /^\d+(\.\d+)?$/
  return pattern.test(value) ? Number(value) : undefined
}

// All three vitals are optional; anything typed must be a number in range.
export function parseVitals(input: VitalsInput): VitalsResult {
  const weight = parseNumber(input.weight, false)
  if (weight === undefined || (weight !== null && !(weight > 0 && weight < WEIGHT_KG_MAX))) {
    return { ok: false, errorKey: 'clinical.weightInvalid' }
  }
  const temperature = parseNumber(input.temperature, false)
  if (
    temperature === undefined ||
    (temperature !== null && !(temperature >= TEMPERATURE_C_MIN && temperature <= TEMPERATURE_C_MAX))
  ) {
    return { ok: false, errorKey: 'clinical.temperatureInvalid' }
  }
  const heartRate = parseNumber(input.heartRate, true)
  if (
    heartRate === undefined ||
    (heartRate !== null && !(heartRate >= HEART_RATE_BPM_MIN && heartRate <= HEART_RATE_BPM_MAX))
  ) {
    return { ok: false, errorKey: 'clinical.heartRateInvalid' }
  }
  return { ok: true, vitals: { weight_kg: weight, temperature_c: temperature, heart_rate_bpm: heartRate } }
}

export type VisitRecordFields = {
  presenting_complaint: string | null
  weight_kg: number | null
  temperature_c: number | null
  heart_rate_bpm: number | null
  physical_exam: string | null
  diagnosis: string | null
  diagnostic_plan: string | null
  treatment: string | null
  notes: string | null
  remarks: string | null
}

// The filled-in parts of a visit record, in clinical order, for display and
// print. Empty fields are left out so old records (which only have
// diagnosis/treatment/notes) don't show a column of blanks.
export function visitRecordFields(record: VisitRecordFields): { labelKey: TranslationKey; value: string }[] {
  const fields: [TranslationKey, string | number | null][] = [
    ['clinical.presentingComplaint', record.presenting_complaint],
    ['clinical.weightKg', record.weight_kg],
    ['clinical.temperatureC', record.temperature_c],
    ['clinical.heartRateBpm', record.heart_rate_bpm],
    ['clinical.physicalExam', record.physical_exam],
    ['petDetail.diagnosis', record.diagnosis],
    ['clinical.diagnosticPlan', record.diagnostic_plan],
    ['petDetail.treatment', record.treatment],
    ['common.notes', record.notes],
    ['clinical.remarks', record.remarks],
  ]
  return fields
    .filter(([, value]) => value !== null && String(value).trim() !== '')
    .map(([labelKey, value]) => ({ labelKey, value: String(value) }))
}
