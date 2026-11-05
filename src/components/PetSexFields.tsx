import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'

// One choice of a pair; pressing the chosen one again clears it, because both fields are optional (H67).
function Choice<T>({ label, value, options, onChange }: { label: TranslationKey; value: T | null; options: [T, TranslationKey][]; onChange: (value: T | null) => void }) {
  const { t } = useLanguage()
  return (
    <div role="group" aria-label={t(label)} className="pet-choice">
      <span>{t(label)}</span>
      <div className="method-toggle">
        {options.map(([option, optionLabel]) => (
          <button
            key={String(option)}
            type="button"
            aria-pressed={value === option}
            className={`secondary-button${value === option ? ' method-toggle-active' : ''}`}
            onClick={() => onChange(value === option ? null : option)}
          >
            {t(optionLabel)}
          </button>
        ))}
      </div>
    </div>
  )
}

function PetSexFields({
  sex,
  neutered,
  onSexChange,
  onNeuteredChange,
}: {
  sex: string | null
  neutered: boolean | null
  onSexChange: (sex: string | null) => void
  onNeuteredChange: (neutered: boolean | null) => void
}) {
  return (
    <>
      <Choice label="pets.sex" value={sex} options={[['male', 'pets.sexMale'], ['female', 'pets.sexFemale']]} onChange={onSexChange} />
      <Choice label="pets.neuteredField" value={neutered} options={[[true, 'pets.neuteredYes'], [false, 'pets.neuteredNo']]} onChange={onNeuteredChange} />
    </>
  )
}

export default PetSexFields
