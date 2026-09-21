import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { POPULAR_SPECIES, speciesIcon, speciesLabel } from '../lib/species'
import { useLanguage } from '../lib/i18n/LanguageContext'

const OTHER = '__other__'

function SpeciesSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (species: string) => void
  disabled?: boolean
}) {
  const { t } = useLanguage()
  const isPopular = POPULAR_SPECIES.some((s) => s.value === value)
  const [showOther, setShowOther] = useState(!isPopular && value !== '')
  const [open, setOpen] = useState(false)

  function handleSelect(next: string) {
    if (next === OTHER) {
      setShowOther(true)
      onChange('')
    } else {
      setShowOther(false)
      onChange(next)
    }
    setOpen(false)
  }

  const Icon = value && !showOther ? speciesIcon(value) : null
  const triggerLabel = showOther ? t('registerPet.other') : value ? speciesLabel(t, value) : t('registerPet.selectSpecies')

  return (
    <>
      <div className="species-select">
        <button
          type="button"
          className="species-select-trigger"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        >
          <span className="species-select-trigger-label">
            {Icon && <Icon className="species-icon" size={18} aria-hidden />}
            <span className={value || showOther ? undefined : 'placeholder'}>{triggerLabel}</span>
          </span>
          <ChevronDown size={16} aria-hidden />
        </button>
        {open && (
          <ul className="species-select-options">
            {POPULAR_SPECIES.map((s) => (
              <li key={s.value}>
                <button type="button" onMouseDown={() => handleSelect(s.value)}>
                  <s.icon className="species-icon" size={18} aria-hidden />
                  {speciesLabel(t, s.value)}
                </button>
              </li>
            ))}
            <li>
              <button type="button" onMouseDown={() => handleSelect(OTHER)}>
                {t('registerPet.other')}
              </button>
            </li>
          </ul>
        )}
      </div>
      {showOther && (
        <input
          type="text"
          className="species-other-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('registerPet.enterSpecies')}
          disabled={disabled}
          required
        />
      )}
    </>
  )
}

export default SpeciesSelect
