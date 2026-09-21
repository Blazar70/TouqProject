import { useEffect, useMemo, useState } from 'react'
import type { Database } from '../lib/database.types'
import { speciesIcon, speciesLabel } from '../lib/species'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import Ltr from './Ltr'

type Pet = Database['public']['Tables']['pets']['Row']

function petLabel(t: (key: TranslationKey) => string, pet: Pet) {
  const species = speciesLabel(t, pet.species)
  const details = pet.breed ? `${species}, ${pet.breed}` : species
  return `${pet.name} (${details}) — ${pet.owner_name}`
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

  const selectedPet = pets.find((p) => p.id === value)

  useEffect(() => {
    setQuery(selectedPet ? petLabel(t, selectedPet) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPet?.id])

  const allMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || selectedPet) return []
    return pets.filter((pet) => pet.name.toLowerCase().includes(q) || (pet.owner_phone ?? '').toLowerCase().includes(q))
  }, [pets, query, selectedPet])

  const matches = useMemo(() => allMatches.slice(0, 8), [allMatches])

  function handleSelect(pet: Pet) {
    onChange(pet.id)
    setQuery(petLabel(t, pet))
    setOpen(false)
  }

  function handleChange(next: string) {
    setQuery(next)
    if (value) onChange('')
    setOpen(true)
  }

  return (
    <div className="pet-picker">
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t('appointments.searchPlaceholder')}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <ul className="pet-picker-results">
          {allMatches.length > matches.length && (
            <li className="pet-picker-count">{t('pets.resultCount', { count: String(matches.length), total: String(allMatches.length) })}</li>
          )}
          {matches.map((pet) => {
            const Icon = speciesIcon(pet.species)
            return (
              <li key={pet.id}>
                <button type="button" onMouseDown={() => handleSelect(pet)}>
                  <span className="pet-picker-title">
                    <Icon className="species-icon" size={16} aria-hidden />
                    <strong>{pet.name}</strong>
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
                </button>
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
