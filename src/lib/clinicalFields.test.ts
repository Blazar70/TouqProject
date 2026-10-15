import { describe, expect, it } from 'vitest'
import { parseVitals, visitRecordFields } from './clinicalFields'

const empty = { weight: '', temperature: '', heartRate: '' }

describe('parseVitals', () => {
  it('accepts all-empty input as all null', () => {
    expect(parseVitals(empty)).toEqual({
      ok: true,
      vitals: { weight_kg: null, temperature_c: null, heart_rate_bpm: null },
    })
  })

  it('parses valid values', () => {
    expect(parseVitals({ weight: ' 4.25 ', temperature: '38.5', heartRate: '120' })).toEqual({
      ok: true,
      vitals: { weight_kg: 4.25, temperature_c: 38.5, heart_rate_bpm: 120 },
    })
  })

  it('accepts Arabic-Indic digits and comma / Arabic decimal separators', () => {
    expect(parseVitals({ weight: '٤٫٥', temperature: '38,5', heartRate: '۹۰' })).toEqual({
      ok: true,
      vitals: { weight_kg: 4.5, temperature_c: 38.5, heart_rate_bpm: 90 },
    })
  })

  it('rejects weight at or beyond the bounds', () => {
    expect(parseVitals({ ...empty, weight: '0' })).toEqual({ ok: false, errorKey: 'clinical.weightInvalid' })
    expect(parseVitals({ ...empty, weight: '2000' })).toEqual({ ok: false, errorKey: 'clinical.weightInvalid' })
    expect(parseVitals({ ...empty, weight: '1999.99' }).ok).toBe(true)
  })

  it('accepts temperature bounds inclusively and rejects outside them', () => {
    expect(parseVitals({ ...empty, temperature: '25' }).ok).toBe(true)
    expect(parseVitals({ ...empty, temperature: '45' }).ok).toBe(true)
    expect(parseVitals({ ...empty, temperature: '385' })).toEqual({ ok: false, errorKey: 'clinical.temperatureInvalid' })
    expect(parseVitals({ ...empty, temperature: '24.9' })).toEqual({ ok: false, errorKey: 'clinical.temperatureInvalid' })
  })

  it('requires a whole-number heart rate in range', () => {
    expect(parseVitals({ ...empty, heartRate: '1' }).ok).toBe(true)
    expect(parseVitals({ ...empty, heartRate: '400' }).ok).toBe(true)
    expect(parseVitals({ ...empty, heartRate: '0' })).toEqual({ ok: false, errorKey: 'clinical.heartRateInvalid' })
    expect(parseVitals({ ...empty, heartRate: '401' })).toEqual({ ok: false, errorKey: 'clinical.heartRateInvalid' })
    expect(parseVitals({ ...empty, heartRate: '80.5' })).toEqual({ ok: false, errorKey: 'clinical.heartRateInvalid' })
  })

  it('rejects non-numeric text and negatives', () => {
    expect(parseVitals({ ...empty, weight: 'abc' })).toEqual({ ok: false, errorKey: 'clinical.weightInvalid' })
    expect(parseVitals({ ...empty, weight: '-3' })).toEqual({ ok: false, errorKey: 'clinical.weightInvalid' })
    expect(parseVitals({ ...empty, temperature: '38.5.1' })).toEqual({ ok: false, errorKey: 'clinical.temperatureInvalid' })
  })
})

describe('visitRecordFields', () => {
  const blank = {
    presenting_complaint: null,
    weight_kg: null,
    temperature_c: null,
    heart_rate_bpm: null,
    physical_exam: null,
    diagnosis: null,
    diagnostic_plan: null,
    treatment: null,
    notes: null,
    remarks: null,
  }

  it('drops empty fields, keeping an old record to diagnosis/treatment/notes', () => {
    expect(visitRecordFields({ ...blank, diagnosis: 'Otitis', treatment: 'Drops', notes: '  ' })).toEqual([
      { labelKey: 'petDetail.diagnosis', value: 'Otitis' },
      { labelKey: 'petDetail.treatment', value: 'Drops' },
    ])
  })

  it('lists filled fields in clinical order, including a numeric vital', () => {
    const fields = visitRecordFields({
      ...blank,
      remarks: 'Recheck in 2 weeks',
      diagnosis: 'Otitis',
      weight_kg: 4.5,
      presenting_complaint: 'Scratching ear',
    })
    expect(fields.map((f) => f.labelKey)).toEqual([
      'clinical.presentingComplaint',
      'clinical.weightKg',
      'petDetail.diagnosis',
      'clinical.remarks',
    ])
    expect(fields[1].value).toBe('4.5')
  })
})
