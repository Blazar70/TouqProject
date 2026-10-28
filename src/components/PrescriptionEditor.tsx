import { useLanguage } from '../lib/i18n/LanguageContext'
import { emptyPrescriptionLine } from '../lib/clinicalFields'
import type { PrescriptionLine } from '../lib/clinicalFields'

// Medicine lines of a prescription (0096); a line without a medicine is dropped on save.
function PrescriptionEditor({ lines, onChange }: { lines: PrescriptionLine[]; onChange: (lines: PrescriptionLine[]) => void }) {
  const { t } = useLanguage()
  const set = (i: number, key: keyof PrescriptionLine, value: string) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, [key]: value } : l)))

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
          </label>
          <label>
            {t('prescription.duration')}
            <input value={line.duration} onChange={(e) => set(i, 'duration', e.target.value)} placeholder={t('prescription.durationHint')} />
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
      <button type="button" className="secondary-button" onClick={() => onChange([...lines, emptyPrescriptionLine()])}>
        {t('prescription.addLine')}
      </button>
    </fieldset>
  )
}

export default PrescriptionEditor
