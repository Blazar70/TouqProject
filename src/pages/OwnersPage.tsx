import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PageSkeleton } from '../components/Skeleton'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useAuth } from '../lib/AuthContext'
import { formatMoney } from '../lib/format'
import { BALANCE_EMBED, flatBalance } from '../lib/owners'
import { searchPattern } from '../lib/search'
import { lastSeen, remember } from '../lib/lastSeen'
import OwnerDetail from '../components/OwnerDetail'
import Ltr from '../components/Ltr'
import FormError from '../components/FormError'

// The API returns at most 1,000 rows (nightly B29): the list shows the first names A–Z, search reaches the rest.
const OWNER_LIST_LIMIT = 100

type OwnerRow = { id: string; name: string; phone: string | null; balance: number; pets: { count: number }[] }

// Owner files (0063): the list, or one owner when ?id= is set.
function OwnersPage() {
  const { t } = useLanguage()
  const { handlesMoney, profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('id')
  const listKey = `owners:${profile?.id}`
  const [owners, setOwners] = useState<OwnerRow[]>(() => lastSeen<{ owners: OwnerRow[]; total: number }>(listKey)?.owners ?? [])
  const [loading, setLoading] = useState(() => !lastSeen(listKey))
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [total, setTotal] = useState(() => lastSeen<{ owners: OwnerRow[]; total: number }>(listKey)?.total ?? 0)
  const request = useRef(0)

  // An older answer never overwrites a newer one.
  async function load() {
    const mine = ++request.current
    const pattern = searchPattern(search)
    let query = supabase
      .from('owner_files')
      .select(`id, name, phone, ${BALANCE_EMBED}, pets(count)`, { count: 'exact' })
      .is('pets.deleted_at', null)
    if (pattern) query = query.ilike('search_text', pattern)
    const { data, count, error: loadError } = await query.order('name').limit(OWNER_LIST_LIMIT)
    if (mine !== request.current) return
    if (loadError) setError(loadError.message)
    else {
      const rows = ((data ?? []) as unknown as (Omit<OwnerRow, 'balance'> & { balance: { balance: number } | null })[]).map(flatBalance)
      setOwners(rows)
      setTotal(count ?? 0)
      if (!pattern) remember(listKey, { owners: rows, total: count ?? 0 })
    }
    setLoading(false)
  }

  useEffect(() => {
    // Reload when coming back from an owner: their balance or pets may have changed.
    if (openId) return
    const timer = window.setTimeout(load, search.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, search])

  if (openId) return <OwnerDetail ownerId={openId} onClose={() => setSearchParams({})} />
  if (loading) return <PageSkeleton title={t('owners.title')} />

  return (
    <div>
      <div className="page-header">
        <h1>{t('owners.title')}</h1>
      </div>
      <FormError message={error} />
      <input
        type="search"
        className="search-input"
        placeholder={t('owners.search')}
        aria-label={t('owners.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {total > owners.length && (
        <p className="search-result-count">
          {t(search.trim() ? 'pets.resultCount' : 'owners.firstShown', { count: String(owners.length), total: String(total) })}
        </p>
      )}
      {owners.length === 0 ? (
        <p className="empty-state">{search.trim() ? t('owners.noneMatch') : t('owners.none')}</p>
      ) : (
        <ul className={`pet-list data-table data-owners${handlesMoney ? '' : ' data-owners-nomoney'}`}>
          <li className="data-head" aria-hidden>
            <span>{t('list.owner')}</span>
            <span>{t('common.phone')}</span>
            <span>{t('owners.pets')}</span>
            {handlesMoney && <span className="data-num">{t('owners.balance')}</span>}
            <span />
          </li>
          {owners.map((owner) => (
            <li key={owner.id} className="pet-list-item">
              <div className="pet-row data-row">
                <button type="button" className="pet-row-toggle data-cell-wide" onClick={() => setSearchParams({ id: owner.id })}>
                  <strong>{owner.name}</strong>
                </button>
                <span className="data-muted">{owner.phone && <Ltr>{owner.phone}</Ltr>}</span>
                <span className="data-muted">{t('owners.petsCount', { count: String(owner.pets[0]?.count ?? 0) })}</span>
                {handlesMoney && (
                  <span className="data-num data-strong">
                    <span className="data-label">{t('owners.balance')}: </span>
                    <Ltr>{formatMoney(owner.balance)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
                  </span>
                )}
                <div className="record-actions data-end">
                  <button type="button" className="secondary-button" onClick={() => setSearchParams({ id: owner.id })}>
                    {t('payments.open')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default OwnersPage
