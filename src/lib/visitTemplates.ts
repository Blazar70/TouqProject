import { cleanPrescription, toPrescription } from './clinicalFields'
import type { RecordEdit } from './clinicalFields'

// Record texts a visit template (0096) can hold, keyed like the record form.
export const TEMPLATE_FIELDS = ['complaint', 'physicalExam', 'diagnosis', 'diagnosticPlan', 'treatment', 'remarks'] as const
export type TemplateField = (typeof TEMPLATE_FIELDS)[number]
const DOCTOR_ONLY: TemplateField[] = ['diagnosis', 'diagnosticPlan', 'treatment']

export type VisitTemplate = { id: string; name: string; fields: unknown; prescription: unknown }

export const templateText = (fields: unknown, key: TemplateField) => {
  const value = (fields as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' ? value : ''
}

// Template texts replace the form's (only where the template has text); its medicines are added after the form's.
// A nurse gets none of the doctor's parts (0075).
export function applyTemplate(form: RecordEdit, template: VisitTemplate, isNurse: boolean): RecordEdit {
  const next = { ...form }
  for (const key of TEMPLATE_FIELDS) {
    const text = templateText(template.fields, key)
    if (text && !(isNurse && DOCTOR_ONLY.includes(key))) next[key] = text
  }
  if (!isNurse) next.prescription = [...cleanPrescription(form.prescription), ...toPrescription(template.prescription)]
  return next
}

// Would applying it replace something already typed?
export const templateOverwrites = (form: RecordEdit, template: VisitTemplate, isNurse: boolean) =>
  TEMPLATE_FIELDS.some((key) => {
    const text = templateText(template.fields, key)
    return text && !(isNurse && DOCTOR_ONLY.includes(key)) && form[key].trim() !== '' && form[key] !== text
  })
