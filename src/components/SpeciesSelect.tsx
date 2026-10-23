import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { POPULAR_SPECIES, speciesIcon, speciesLabel } from '../lib/species'
import { useLanguage } from '../lib/i18n/LanguageContext'

const OTHER = '__other__'
const OPTIONS = [...POPULAR_SPECIES.map((s) => s.value), OTHER]

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
  const [active, setActive] = useState(0)
  const listId = useId()

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

  function openList() {
    setActive(Math.max(0, OPTIONS.indexOf(showOther ? OTHER : value)))
    setOpen(true)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return openList()
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : OPTIONS.length - 1)) % OPTIONS.length)
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault()
      handleSelect(OPTIONS[active])
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    }
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
          // Callers wrap this in a <label>; without an own name it would read every option.
          aria-label={`${t('registerPet.species')}: ${triggerLabel}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        >
          <span className="species-select-trigger-label">
            {Icon && <Icon className="species-icon" size={18} aria-hidden />}
            <span className={value || showOther ? undefined : 'placeholder'}>{triggerLabel}</span>
          </span>
          <ChevronDown size={16} aria-hidden />
        </button>
        {open && (
          <ul className="species-select-options" role="listbox" id={listId}>
            {OPTIONS.map((option, i) => {
              const popular = POPULAR_SPECIES.find((s) => s.value === option)
              return (
                <li
                  key={option}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`species-select-option${i === active ? ' species-select-option-active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelect(option)
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {popular && <popular.icon className="species-icon" size={18} aria-hidden />}
                  {popular ? speciesLabel(t, option) : t('registerPet.other')}
                </li>
              )
            })}
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
          aria-label={t('registerPet.enterSpecies')}
          disabled={disabled}
          required
        />
      )}
    </>
  )
}

export default SpeciesSelect
