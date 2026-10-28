import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { applyTemplate, templateOverwrites } from '../lib/visitTemplates'
import type { VisitTemplate } from '../lib/visitTemplates'
import type { RecordEdit } from '../lib/clinicalFields'

// "Use a template" above the visit record; hidden while the clinic has none (Settings > Visit templates).
function TemplatePicker({ form, onApply }: { form: RecordEdit; onApply: (form: RecordEdit) => void }) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const isNurse = profile?.clinic_role === 'nurse'
  const [templates, setTemplates] = useState<VisitTemplate[]>([])

  useEffect(() => {
    supabase
      .from('visit_templates')
      .select('id, name, fields, prescription')
      .order('name')
      .then(({ data }) => setTemplates(data ?? []))
  }, [])

  async function pick(id: string) {
    const template = templates.find((tpl) => tpl.id === id)
    if (!template) return
    if (templateOverwrites(form, template, isNurse) && !(await confirm(t('templates.overwriteConfirm', { name: template.name })))) return
    onApply(applyTemplate(form, template, isNurse))
  }

  if (templates.length === 0) return null
  return (
    <label>
      {t('templates.use')}
      {/* value stays empty: picking applies the template once, the select resets */}
      <select value="" onChange={(e) => pick(e.target.value)}>
        <option value="">{t('templates.choose')}</option>
        {templates.map((tpl) => (
          <option key={tpl.id} value={tpl.id}>
            {tpl.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export default TemplatePicker
