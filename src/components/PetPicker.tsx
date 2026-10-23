import { useEffect, useId, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Database } from '../lib/database.types'
import { speciesIcon, speciesLabel } from '../lib/species'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import Ltr from './Ltr'
import { matchesPetSearch } from '../lib/appointmentSearch'

type Pet = Database['public']['Tables']['pets']['Row']

function petLabel(t: (key: TranslationKey) => string, pet: Pet) {
  const species = speciesLabel(t, pet.species)
  const details = pet.breed ? `${species}, ${pet.breed}` : species
  return `${pet.name} · ${pet.pet_number} (${details}) — ${pet.owner_name}`
}

function PetPicker({
  pets,
  value,
  onChange,
}: {
  pets: Pet[]
  value: string
  onChange: (petId: string) => void
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const selectedPet = pets.find((p) => p.id === value)

  useEffect(() => {
    setQuery(selectedPet ? petLabel(t, selectedPet) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPet?.id])

  const allMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || selectedPet) return []
    return pets.filter((pet) => matchesPetSearch(pet, q))
  }, [pets, query, selectedPet])

  const matches = useMemo(() => allMatches.slice(0, 8), [allMatches])
  const showList = open && matches.length > 0

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      if (matches.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
    } else if (e.key === 'Enter' && showList) {
      // Pick the highlighted pet instead of submitting the form.
      e.preventDefault()
      handleSelect(matches[active] ?? matches[0])
    }
  }

  function handleSelect(pet: Pet) {
    onChange(pet.id)
    setQuery(petLabel(t, pet))
    setOpen(false)
  }

  function handleChange(next: string) {
    setQuery(next)
    if (value) onChange('')
    setOpen(true)
    setActive(0)
  }

  return (
    <div className="pet-picker">
      <input
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        onKeyDown={handleKeyDown}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t('pets.searchPlaceholder')}
        autoComplete="off"
      />
      {showList && (
        <ul className="pet-picker-results" role="listbox" id={listId}>
          {allMatches.length > matches.length && (
            <li className="pet-picker-count" role="presentation">{t('pets.resultCount', { count: String(matches.length), total: String(allMatches.length) })}</li>
          )}
          {matches.map((pet, i) => {
            const Icon = speciesIcon(pet.species)
            return (
              <li
                key={pet.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`pet-picker-option${i === active ? ' pet-picker-option-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelect(pet)
                }}
                onMouseEnter={() => setActive(i)}
              >
                  <span className="pet-picker-title">
                    <Icon className="species-icon" size={16} aria-hidden />
                    <strong>{pet.name}</strong>
                    <Ltr className="pet-owner">{pet.pet_number}</Ltr>
                    <span className="pet-owner">
                      {pet.breed ? `${speciesLabel(t, pet.species)}, ${pet.breed}` : speciesLabel(t, pet.species)}
                    </span>
                  </span>
                  <span className="pet-owner">
                    {pet.owner_name}
                    {pet.owner_phone ? (
                      <>
                        {' · '}
                        <Ltr>{pet.owner_phone}</Ltr>
                      </>
                    ) : (
                      ''
                    )}
                  </span>
              </li>
            )
          })}
        </ul>
      )}
      {open && query.trim() && !selectedPet && matches.length === 0 && (
        <div className="pet-picker-empty">{t('appointments.noMatch', { query })}</div>
      )}
    </div>
  )
}

export default PetPicker
