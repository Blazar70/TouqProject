import { useEffect, useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { searchNorm, searchPattern } from '../lib/search'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import Modal from './Modal'
import Ltr from './Ltr'

// number: Pet ID or phone (left to right); meta: plain text such as the owner's name.
type Result = { key: string; group: TranslationKey; label: string; number?: string; meta?: string; to: string }

// Ctrl+K / ⌘K (UI tips 3 + 4): one box that jumps to a pet, an owner or a page, by keyboard or tap.
function QuickSearch({ pages, onClose }: { pages: { to: string; label: TranslationKey }[]; onClose: () => void }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ query: string; results: Result[] }>({ query: '', results: [] })
  const [active, setActive] = useState(0)

  const q = searchNorm(query.trim())
  const pageResults: Result[] = pages
    .filter((p) => !q || searchNorm(t(p.label)).includes(q))
    .map((p) => ({ key: `page-${p.to}`, group: 'search.pages', label: t(p.label), to: p.to }))

  useEffect(() => {
    const pattern = searchPattern(query)
    if (!pattern) return
    let live = true
    const timer = window.setTimeout(async () => {
      const [pets, owners] = await Promise.all([
        supabase.from('pets').select('id, name, pet_number, owner_name').is('deleted_at', null).ilike('search_text', pattern).order('name').limit(5),
        supabase.from('owner_files').select('id, name, phone').ilike('search_text', pattern).order('name').limit(5),
      ])
      if (!live) return
      setFound({
        query,
        results: [
          ...(pets.data ?? []).map((p) => ({ key: `pet-${p.id}`, group: 'nav.pets' as const, label: p.name, number: String(p.pet_number), meta: p.owner_name, to: `/pets/${p.id}` })),
          ...(owners.data ?? []).map((o) => ({ key: `owner-${o.id}`, group: 'nav.owners' as const, label: o.name, number: o.phone ?? undefined, to: `/owners?id=${o.id}` })),
        ],
      })
      setActive(0)
    }, 200)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [query])

  const results = [...pageResults, ...(q && found.query === query ? found.results : [])]

  function open(result: Result | undefined) {
    if (!result) return
    onClose()
    navigate(result.to, { viewTransition: true })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      open(results[active] ?? results[0])
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="quick-search-title" className="quick-search">
      <h2 id="quick-search-title" className="visually-hidden">
        {t('search.open')}
      </h2>
      <input
        type="text"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
        aria-labelledby="quick-search-title"
        className="search-input"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        autoFocus
      />
      <ul className="quick-search-results" role="listbox" id={listId}>
        {results.map((r, i) => (
          <li
            key={r.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`quick-search-option${i === active ? ' quick-search-option-active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault()
              open(r)
            }}
            onMouseEnter={() => setActive(i)}
          >
            {(i === 0 || results[i - 1].group !== r.group) && <span className="quick-search-group">{t(r.group)}</span>}
            <span className="quick-search-label">
              <strong>{r.label}</strong>
              {r.number && <Ltr className="pet-owner">{r.number}</Ltr>}
              {r.meta && <span className="pet-owner">{r.meta}</span>}
            </span>
          </li>
        ))}
      </ul>
      {q && found.query === query && results.length === 0 && <p className="pet-owner">{t('search.none', { query })}</p>}
      <p className="quick-search-keys" aria-hidden>
        <kbd>↑</kbd>
        <kbd>↓</kbd> {t('search.keyMove')} · <kbd>Enter</kbd> {t('search.keyOpen')} · <kbd>Esc</kbd> {t('search.keyClose')}
      </p>
    </Modal>
  )
}

export default QuickSearch
