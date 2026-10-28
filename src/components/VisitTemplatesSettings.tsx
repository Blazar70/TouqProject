import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import { cleanPrescription, toPrescription } from '../lib/clinicalFields'
import type { PrescriptionLine } from '../lib/clinicalFields'
import { TEMPLATE_FIELDS, templateText } from '../lib/visitTemplates'
import type { TemplateField, VisitTemplate } from '../lib/visitTemplates'
import type { TranslationKey } from '../lib/i18n/translations'
import FormError from './FormError'
import RequiredMark from './RequiredMark'
import PrescriptionEditor from './PrescriptionEditor'

const FIELD_LABEL: Record<TemplateField, TranslationKey> = {
  complaint: 'clinical.presentingComplaint',
  physicalExam: 'clinical.physicalExam',
  diagnosis: 'petDetail.diagnosis',
  diagnosticPlan: 'clinical.diagnosticPlan',
  treatment: 'petDetail.treatment',
  remarks: 'clinical.remarks',
}
const emptyFields = () => Object.fromEntries(TEMPLATE_FIELDS.map((k) => [k, ''])) as Record<TemplateField, string>

// Settings > Visit templates (0096): shared by the clinic; doctors and managers keep them.
function VisitTemplatesSettings({ clinicId }: { clinicId: string }) {
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const [templates, setTemplates] = useState<VisitTemplate[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [fields, setFields] = useState(emptyFields)
  const [lines, setLines] = useState<PrescriptionLine[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error: loadError } = await supabase.from('visit_templates').select('id, name, fields, prescription').order('name')
    if (loadError) setError(loadError.message)
    setTemplates(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  function startEdit(template: VisitTemplate | null) {
    setEditingId(template?.id ?? null)
    setName(template?.name ?? '')
    setFields(template ? (Object.fromEntries(TEMPLATE_FIELDS.map((k) => [k, templateText(template.fields, k)])) as Record<TemplateField, string>) : emptyFields())
    setLines(toPrescription(template?.prescription))
    setError(null)
    setOpen(true)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const values = {
      name: name.trim(),
      fields: Object.fromEntries(TEMPLATE_FIELDS.map((k) => [k, fields[k].trim()]).filter(([, v]) => v)),
      prescription: cleanPrescription(lines),
    }
    const { error: saveError } = editingId
      ? await supabase.from('visit_templates').update(values).eq('id', editingId)
      : await supabase.from('visit_templates').insert({ ...values, clinic_id: clinicId })
    setSaving(false)
    if (saveError) {
      setError(saveError.code === '23505' ? t('templates.nameTaken') : saveError.message)
      return
    }
    toast.success(t('templates.saved', { name: values.name }))
    setOpen(false)
    await load()
  }

  async function handleDelete(template: VisitTemplate) {
    if (!(await confirm(t('templates.deleteConfirm', { name: template.name }), { danger: true, confirmLabel: t('common.delete') }))) return
    const { error: deleteError } = await supabase.from('visit_templates').delete().eq('id', template.id)
    if (deleteError) return toast.error(deleteError.message)
    if (editingId === template.id) setOpen(false)
    await load()
  }

  if (!templates) return <p>{t('common.loading')}</p>

  return (
    <>
      {templates.length === 0 ? (
        <p className="pet-owner">{t('templates.none')}</p>
      ) : (
        <ul className="record-list">
          {templates.map((template) => (
            <li key={template.id}>
              <div className="record-row">
                <strong>{template.name}</strong>
                <div className="record-actions">
                  <button type="button" className="secondary-button" onClick={() => startEdit(template)}>
                    {t('common.edit')}
                  </button>
                  <button type="button" className="delete-button" onClick={() => handleDelete(template)}>
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <form onSubmit={handleSave} className="pet-form">
          <FormError message={error} />
          <label>
            {t('templates.name')}
            <RequiredMark />
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </label>
          {TEMPLATE_FIELDS.map((key) => (
            <label key={key}>
              {t(FIELD_LABEL[key])}
              <textarea value={fields[key]} onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))} rows={2} />
            </label>
          ))}
          <PrescriptionEditor lines={lines} onChange={setLines} />
          <div className="record-edit-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="cancel-button" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => startEdit(null)}>
          + {t('templates.add')}
        </button>
      )}
    </>
  )
}

export default VisitTemplatesSettings
