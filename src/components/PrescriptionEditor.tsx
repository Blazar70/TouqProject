import { useLanguage } from '../lib/i18n/LanguageContext'
import { emptyPrescriptionLine } from '../lib/clinicalFields'
import type { PrescriptionLine } from '../lib/clinicalFields'
import type { TranslationKey } from '../lib/i18n/translations'

// H35: one tap fills the usual answers; the text lands in the app language and stays editable.
const QUICK: Partial<Record<keyof PrescriptionLine, TranslationKey[]>> = {
  frequency: ['prescription.onceDaily', 'prescription.twiceDaily', 'prescription.every8h', 'prescription.every12h'],
  duration: ['prescription.days3', 'prescription.days5', 'prescription.days7', 'prescription.days14'],
}

// Medicine lines of a prescription (0096); a line without a medicine is dropped on save.
// lastLines = this pet's previous prescription, offered as "Repeat last prescription".
function PrescriptionEditor({
  lines,
  onChange,
  lastLines = [],
}: {
  lines: PrescriptionLine[]
  onChange: (lines: PrescriptionLine[]) => void
  lastLines?: PrescriptionLine[]
}) {
  const { t } = useLanguage()
  const set = (i: number, key: keyof PrescriptionLine, value: string) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, [key]: value } : l)))
  const quick = (i: number, key: keyof PrescriptionLine) =>
    QUICK[key] && (
      <span className="prescription-quick">
        {QUICK[key].map((k) => (
          <button key={k} type="button" className="secondary-button" aria-pressed={lines[i][key] === t(k)} onClick={() => set(i, key, t(k))}>
            {t(k)}
          </button>
        ))}
      </span>
    )

  return (
    <fieldset className="prescription-editor">
      <legend>{t('prescription.title')}</legend>
      {lines.map((line, i) => (
        <div key={i} className="prescription-line">
          <label>
            {t('prescription.medicine')}
            <input value={line.medicine} onChange={(e) => set(i, 'medicine', e.target.value)} />
          </label>
          <label>
            {t('prescription.dose')}
            <input value={line.dose} onChange={(e) => set(i, 'dose', e.target.value)} placeholder={t('prescription.doseHint')} />
          </label>
          <label>
            {t('prescription.frequency')}
            <input value={line.frequency} onChange={(e) => set(i, 'frequency', e.target.value)} placeholder={t('prescription.frequencyHint')} />
            {quick(i, 'frequency')}
          </label>
          <label>
            {t('prescription.duration')}
            <input value={line.duration} onChange={(e) => set(i, 'duration', e.target.value)} placeholder={t('prescription.durationHint')} />
            {quick(i, 'duration')}
          </label>
          <label className="prescription-note">
            {t('common.notes')}
            <input value={line.note} onChange={(e) => set(i, 'note', e.target.value)} />
          </label>
          <button
            type="button"
            className="cancel-button"
            onClick={() => onChange(lines.filter((_, j) => j !== i))}
            aria-label={t('prescription.removeLine', { medicine: line.medicine || String(i + 1) })}
          >
            {t('prescription.remove')}
          </button>
        </div>
      ))}
      <div className="record-actions">
        <button type="button" className="secondary-button" onClick={() => onChange([...lines, emptyPrescriptionLine()])}>
          {t('prescription.addLine')}
        </button>
        {lastLines.length > 0 && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChange([...lines.filter((l) => l.medicine.trim()), ...lastLines])}
            title={lastLines.map((l) => l.medicine).join(', ')}
          >
            {t('prescription.repeatLast')}
          </button>
        )}
      </div>
    </fieldset>
  )
}

export default PrescriptionEditor
