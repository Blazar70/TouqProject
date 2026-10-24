import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { STARTER_WAIVERS } from '../lib/waivers'
import FormError from './FormError'
import RequiredMark from './RequiredMark'

type Template = Database['public']['Tables']['waiver_templates']['Row']
type Draft = Pick<Template, 'title_en' | 'title_ar' | 'body_en' | 'body_ar' | 'suggest_on_admit'>

const EMPTY: Draft = { title_en: '', title_ar: '', body_en: '', body_ar: '', suggest_on_admit: false }

// The clinic's waiver texts (0084), English and Arabic. Managers only; archived, never deleted.
function WaiverTemplatesSettings({ clinicId }: { clinicId: string }) {
  const { t, language } = useLanguage()
  const toast = useToast()
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error: loadError } = await supabase.from('waiver_templates').select('*').order('created_at')
    if (loadError) setError(loadError.message)
    setTemplates(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  function edit(template: Template | null) {
    setEditingId(template?.id ?? 'new')
    setDraft(template ? { title_en: template.title_en, title_ar: template.title_ar, body_en: template.body_en, body_ar: template.body_ar, suggest_on_admit: template.suggest_on_admit } : EMPTY)
    setError(null)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const values = { ...draft, title_en: draft.title_en.trim(), title_ar: draft.title_ar.trim() }
    const { error: saveError } =
      editingId === 'new'
        ? await supabase.from('waiver_templates').insert({ ...values, clinic_id: clinicId })
        : await supabase.from('waiver_templates').update(values).eq('id', editingId!)
    setSaving(false)
    if (saveError) return setError(saveError.message)
    toast.success(t('waivers.templateSaved'))
    setEditingId(null)
    load()
  }

  async function handleStarters() {
    setSaving(true)
    const { error: saveError } = await supabase.from('waiver_templates').insert(STARTER_WAIVERS.map((w) => ({ ...w, clinic_id: clinicId })))
    setSaving(false)
    if (saveError) return toast.error(saveError.message)
    load()
  }

  async function setActive(template: Template, active: boolean) {
    const { error: saveError } = await supabase.from('waiver_templates').update({ active }).eq('id', template.id)
    if (saveError) return toast.error(saveError.message)
    load()
  }

  if (!templates) return <p>{t('common.loading')}</p>

  const field = (key: keyof Draft, labelKey: TranslationKey, dir: 'ltr' | 'rtl', rows?: number) => (
    <label>
      {t(labelKey)}
      <RequiredMark />
      {rows ? (
        <textarea dir={dir} rows={rows} value={draft[key] as string} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} required />
      ) : (
        <input dir={dir} value={draft[key] as string} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} required />
      )}
    </label>
  )

  return (
    <>
      {templates.length === 0 ? (
        <>
          <p className="pet-owner">{t('waivers.noTemplates')}</p>
          <button type="button" className="secondary-button" disabled={saving} onClick={handleStarters}>
            {t('waivers.addStarters')}
          </button>
        </>
      ) : (
        <ul className="record-list">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <div className="record-row">
                <div>
                  <strong>{language === 'ar' ? tpl.title_ar : tpl.title_en}</strong>
                  <div className="pet-owner">
                    {[!tpl.active && t('waivers.archived'), tpl.suggest_on_admit && t('waivers.suggestOnAdmitShort')].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="record-actions">
                  <button type="button" className="secondary-button" onClick={() => edit(tpl)}>
                    {t('common.edit')}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setActive(tpl, !tpl.active)}>
                    {t(tpl.active ? 'waivers.archive' : 'waivers.restore')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingId ? (
        <form onSubmit={handleSave} className="pet-form">
          <FormError message={error} />
          {field('title_en', 'waivers.titleEn', 'ltr')}
          {field('body_en', 'waivers.bodyEn', 'ltr', 8)}
          {field('title_ar', 'waivers.titleAr', 'rtl')}
          {field('body_ar', 'waivers.bodyAr', 'rtl', 8)}
          <label className="checkbox-label">
            <input type="checkbox" checked={draft.suggest_on_admit} onChange={(e) => setDraft({ ...draft, suggest_on_admit: e.target.checked })} />
            {t('waivers.suggestOnAdmit')}
          </label>
          <div className="record-edit-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="cancel-button" onClick={() => setEditingId(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="secondary-button" onClick={() => edit(null)}>
          + {t('waivers.newTemplate')}
        </button>
      )}
    </>
  )
}

export default WaiverTemplatesSettings
