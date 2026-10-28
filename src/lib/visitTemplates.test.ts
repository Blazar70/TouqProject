import { describe, expect, it } from 'vitest'
import { recordToEdit } from './clinicalFields'
import { applyTemplate, templateOverwrites } from './visitTemplates'

const template = {
  id: 't',
  name: 'Ear check',
  fields: { diagnosis: 'Otitis', remarks: 'Recheck in 7 days', complaint: '' },
  prescription: [{ medicine: 'Ear drops', dose: '3 drops', frequency: 'twice a day', duration: '7 days', note: '' }],
}

describe('applyTemplate', () => {
  it('fills texts the template has and adds its medicines', () => {
    const form = { ...recordToEdit(null), complaint: 'Scratching ears' }
    const next = applyTemplate(form, template, false)
    expect(next.complaint).toBe('Scratching ears')
    expect(next.diagnosis).toBe('Otitis')
    expect(next.prescription.map((l) => l.medicine)).toEqual(['Ear drops'])
  })

  it('gives a nurse none of the doctor parts', () => {
    const next = applyTemplate(recordToEdit(null), template, true)
    expect(next.diagnosis).toBe('')
    expect(next.prescription).toEqual([])
    expect(next.remarks).toBe('Recheck in 7 days')
  })

  it('reports when typed text would be replaced', () => {
    expect(templateOverwrites(recordToEdit(null), template, false)).toBe(false)
    expect(templateOverwrites({ ...recordToEdit(null), diagnosis: 'Other' }, template, false)).toBe(true)
  })
})
