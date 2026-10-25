import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useAuth } from '../lib/AuthContext'
import { formatMoney } from '../lib/format'
import { BALANCE_EMBED, flatBalance, matchesOwner } from '../lib/owners'
import LoadingScreen from '../components/LoadingScreen'
import OwnerDetail from '../components/OwnerDetail'
import Ltr from '../components/Ltr'
import FormError from '../components/FormError'

type OwnerRow = { id: string; name: string; phone: string | null; balance: number; pets: { count: number }[] }

// Owner files (0063): the list, or one owner when ?id= is set.
function OwnersPage() {
  const { t } = useLanguage()
  const { handlesMoney } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('id')
  const [owners, setOwners] = useState<OwnerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  async function load() {
    const { data, error: loadError } = await supabase
      .from('owner_files')
      .select(`id, name, phone, ${BALANCE_EMBED}, pets(count)`)
      .is('pets.deleted_at', null)
      .order('name')
    if (loadError) setError(loadError.message)
    else setOwners(((data ?? []) as unknown as (Omit<OwnerRow, 'balance'> & { balance: { balance: number } | null })[]).map(flatBalance))
    setLoading(false)
  }

  useEffect(() => {
    // Reload when coming back from an owner: their balance or pets may have changed.
    if (!openId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  const filtered = useMemo(() => owners.filter((o) => matchesOwner(o, search)), [owners, search])

  if (openId) return <OwnerDetail ownerId={openId} onClose={() => setSearchParams({})} />
  if (loading) return <LoadingScreen />

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
      {filtered.length === 0 ? (
        <p className="empty-state">{owners.length === 0 ? t('owners.none') : t('owners.noneMatch')}</p>
      ) : (
        <ul className={`pet-list data-table data-owners${handlesMoney ? '' : ' data-owners-nomoney'}`}>
          <li className="data-head" aria-hidden>
            <span>{t('list.owner')}</span>
            <span>{t('common.phone')}</span>
            <span>{t('owners.pets')}</span>
            {handlesMoney && <span className="data-num">{t('owners.balance')}</span>}
            <span />
          </li>
          {filtered.map((owner) => (
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
