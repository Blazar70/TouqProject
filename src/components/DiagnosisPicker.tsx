import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'

// Optional list above the free-text diagnosis; hidden while the clinic has none (Settings > Diagnosis list).
// It only fills the text: the database links the visit to the term when the text matches (0106).
function DiagnosisPicker({ onPick }: { onPick: (name: string) => void }) {
  const { t, language } = useLanguage()
  const [terms, setTerms] = useState<{ id: string; name_en: string; name_ar: string }[]>([])

  useEffect(() => {
    supabase
      .from('diagnosis_terms')
      .select('id, name_en, name_ar')
      .eq('active', true)
      .order(language === 'ar' ? 'name_ar' : 'name_en')
      .then(({ data }) => setTerms(data ?? []))
  }, [language])

  if (terms.length === 0) return null
  return (
    <label>
      {t('diagnosisTerms.pick')}
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value)
        }}
      >
        <option value="">{t('diagnosisTerms.pickPlaceholder')}</option>
        {terms.map((term) => {
          const name = language === 'ar' ? term.name_ar : term.name_en
          return (
            <option key={term.id} value={name}>
              {name}
            </option>
          )
        })}
      </select>
    </label>
  )
}

export default DiagnosisPicker
