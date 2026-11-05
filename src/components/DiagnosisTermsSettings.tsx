import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import FormError from './FormError'
import RequiredMark from './RequiredMark'

type Term = Database['public']['Tables']['diagnosis_terms']['Row']

// Settings > Diagnosis list (0106): doctors and managers keep it. Removing archives, so old visits stay counted.
function DiagnosisTermsSettings({ clinicId }: { clinicId: string }) {
  const { t } = useLanguage()
  const toast = useToast()
  const [terms, setTerms] = useState<Term[] | null>(null)
  const [editing, setEditing] = useState<Term | 'new' | null>(null)
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error: loadError } = await supabase.from('diagnosis_terms').select('*').order('name_en')
    if (loadError) setError(loadError.message)
    setTerms(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  function startEdit(term: Term | 'new') {
    setEditing(term)
    setNameEn(term === 'new' ? '' : term.name_en)
    setNameAr(term === 'new' ? '' : term.name_ar)
    setError(null)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const names = { name_en: nameEn.trim(), name_ar: nameAr.trim() }
    const { error: saveError } =
      editing === 'new' || !editing
        ? await supabase.from('diagnosis_terms').insert({ ...names, clinic_id: clinicId })
        : await supabase.from('diagnosis_terms').update(names).eq('id', editing.id)
    setSaving(false)
    if (saveError) {
      setError(saveError.code === '23505' ? t('diagnosisTerms.duplicate') : saveError.message)
      return
    }
    setEditing(null)
    toast.success(t('diagnosisTerms.saved'))
    load()
  }

  async function setActive(term: Term, active: boolean) {
    const { error: saveError } = await supabase.from('diagnosis_terms').update({ active }).eq('id', term.id)
    if (saveError) toast.error(saveError.message)
    else load()
  }

  const active = terms?.filter((term) => term.active) ?? []
  const removed = terms?.filter((term) => !term.active) ?? []

  return (
    <div>
      {!editing && <FormError message={error} />}
      {terms && active.length === 0 && <p className="empty-state">{t('diagnosisTerms.empty')}</p>}
      {active.length > 0 && (
        <ul className="record-list">
          {active.map((term) => (
            <li key={term.id} className="record-row">
              <span>
                <strong>{term.name_en}</strong> · <bdi>{term.name_ar}</bdi>
              </span>
              <span className="record-actions">
                <button type="button" className="secondary-button" onClick={() => startEdit(term)}>
                  {t('common.edit')}
                </button>
                <button type="button" className="cancel-button" onClick={() => setActive(term, false)}>
                  {t('diagnosisTerms.remove')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <form onSubmit={handleSave} className="pet-form">
          <FormError message={error} />
          <label>
            {t('diagnosisTerms.nameEn')}
            <RequiredMark />
            <input dir="ltr" value={nameEn} maxLength={100} onChange={(e) => setNameEn(e.target.value)} required />
          </label>
          <label>
            {t('diagnosisTerms.nameAr')}
            <RequiredMark />
            <input dir="rtl" value={nameAr} maxLength={100} onChange={(e) => setNameAr(e.target.value)} required />
          </label>
          <div className="record-edit-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="cancel-button" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="secondary-button" onClick={() => startEdit('new')}>
          {t('diagnosisTerms.add')}
        </button>
      )}
      {removed.length > 0 && (
        <>
          <h3>{t('diagnosisTerms.removed')}</h3>
          <ul className="record-list">
            {removed.map((term) => (
              <li key={term.id} className="record-row">
                <span className="pet-owner">
                  {term.name_en} · <bdi>{term.name_ar}</bdi>
                </span>
                <button type="button" className="secondary-button" onClick={() => setActive(term, true)}>
                  {t('diagnosisTerms.restore')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default DiagnosisTermsSettings
