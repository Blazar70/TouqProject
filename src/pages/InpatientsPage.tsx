import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useBranch, useBranchView } from '../lib/BranchContext'
import { ALL_BRANCHES } from '../lib/branchChoice'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { formatDateTime } from '../lib/format'
import { stayDay } from '../lib/inpatient'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import RefreshButton from '../components/RefreshButton'
import BranchFilter from '../components/BranchFilter'
import FormError from '../components/FormError'

type Stay = Database['public']['Tables']['inpatient_stays']['Row'] & {
  pet: { id: string; name: string; owner_name: string } | null
  last: { created_at: string; note: string | null; author: { full_name: string } | null }[]
}

// Everyone admitted right now, clinic-wide with the branch they are at (0081). Admitting is done
// from the pet file, where the stay's updates live too.
function InpatientsPage() {
  const { t } = useLanguage()
  const { branchName } = useBranch()
  // Branches are no wall (clinic answer): open on all.
  const [viewBranch, setViewBranch] = useBranchView(true)
  const [stays, setStays] = useState<Stay[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    let query = supabase
      .from('inpatient_stays')
      .select('*, pet:pets(id, name, owner_name), last:inpatient_updates(created_at, note, author:profiles!inpatient_updates_author_id_fkey(full_name))')
      .is('discharged_at', null)
      .order('admitted_at', { ascending: true })
      .order('created_at', { referencedTable: 'inpatient_updates', ascending: false })
      .limit(1, { referencedTable: 'inpatient_updates' })
    if (viewBranch !== ALL_BRANCHES) query = query.eq('branch_id', viewBranch)
    const { data, error: loadError } = await query
    setError(loadError ? loadError.message : null)
    setStays((data as Stay[] | null) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per branch
  }, [viewBranch])

  async function handleRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  if (stays === null) return <LoadingScreen />

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('inpatient.pageTitle')}</h1>
          <p className="page-subtitle">{t('inpatient.pageCount', { count: String(stays.length) })}</p>
        </div>
        <div className="page-header-actions">
          <BranchFilter value={viewBranch} onChange={setViewBranch} />
          <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
        </div>
      </div>

      <FormError message={error} />

      {stays.length === 0 ? (
        <p className="empty-state">{t('inpatient.pageEmpty')}</p>
      ) : (
        <ul className="pet-list data-table data-inpatients">
          <li className="data-head" aria-hidden>
            <span>{t('inpatient.colPet')}</span>
            <span>{t('inpatient.colDay')}</span>
            <span>{t('inpatient.colBranch')}</span>
            <span>{t('inpatient.colLast')}</span>
          </li>
          {stays.map((stay) => {
            const last = stay.last[0]
            return (
              <li key={stay.id} className="pet-list-item">
                <Link to={`/pets/${stay.pet_id}`} className="pet-row data-row">
                  <span>
                    <strong className="data-strong">{stay.pet?.name}</strong>
                    <span className="data-muted"> · {stay.pet?.owner_name}</span>
                    {stay.reason && <span className="data-muted"> · {stay.reason}</span>}
                  </span>
                  <span className="data-num">{t('inpatient.day', { count: String(stayDay(stay.admitted_at)) })}</span>
                  <span>{branchName(stay.branch_id)}</span>
                  <span className="data-muted">
                    {last ? (
                      <>
                        <Ltr>{formatDateTime(last.created_at)}</Ltr> · {last.author?.full_name ?? '—'}
                        {last.note && ` · ${last.note}`}
                      </>
                    ) : (
                      t('inpatient.noUpdates')
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default InpatientsPage
