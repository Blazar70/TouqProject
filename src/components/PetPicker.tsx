import { useEffect, useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { searchPattern } from '../lib/search'
import { rememberPets } from '../lib/usePet'
import { speciesIcon, speciesLabel } from '../lib/species'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import Ltr from './Ltr'

type Pet = Database['public']['Tables']['pets']['Row']

// compact: just name and Pet ID, for forms that show the owner right below (booking; user 10-28: the full label clipped on phones).
function petLabel(t: (key: TranslationKey) => string, pet: Pet, compact = false) {
  if (compact) return `${pet.name} · ${pet.pet_number}`
  const species = speciesLabel(t, pet.species)
  const details = pet.breed ? `${species}, ${pet.breed}` : species
  return `${pet.name} · ${pet.pet_number} (${details}) — ${pet.owner_name}`
}

const SHOWN = 8

// Searches the clinic's pets on the server as the user types (nightly B29/H39); the newest pets when the box is empty.
// `pet` is the selected pet (the parent loads it with usePet, so ids from links work too).
function PetPicker({
  pet: selectedPet,
  value,
  onChange,
  compact = false,
}: {
  pet: Pet | null | undefined
  value: string
  onChange: (petId: string) => void
  compact?: boolean
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const [found, setFound] = useState<{ query: string; pets: Pet[]; total: number } | null>(null)

  useEffect(() => {
    setQuery(selectedPet ? petLabel(t, selectedPet, compact) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPet?.id])

  const searching = open && !value
  useEffect(() => {
    if (!searching) return
    let live = true
    const pattern = searchPattern(query)
    // Wait for a pause in typing before asking the server.
    const timer = window.setTimeout(async () => {
      let request = supabase.from('pets').select('*', { count: 'exact' }).is('deleted_at', null)
      request = pattern ? request.ilike('search_text', pattern).order('name') : request.order('created_at', { ascending: false })
      const { data, count } = await request.limit(SHOWN)
      if (!live) return
      rememberPets(data ?? [])
      setFound({ query, pets: data ?? [], total: count ?? 0 })
    }, pattern ? 250 : 0)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [query, searching])

  const matches = searching && found ? found.pets : []
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
    setQuery(petLabel(t, pet, compact))
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
          {!query.trim() && <li className="pet-picker-count" role="presentation">{t('pets.recent')}</li>}
          {found && found.total > matches.length && (
            <li className="pet-picker-count" role="presentation">{t('pets.resultCount', { count: String(matches.length), total: String(found.total) })}</li>
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
      {searching && query.trim() && found?.query === query && matches.length === 0 && (
        <div className="pet-picker-empty">{t('appointments.noMatch', { query })}</div>
      )}
    </div>
  )
}

export default PetPicker
