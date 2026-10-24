import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import { clinicDay, formatMoney, formatTime } from '../lib/format'
import Ltr from './Ltr'

type Count = { branch_id: string; counted: number; counted_at: string; counter: { full_name: string } | null }

// Cash-up: what was actually counted in each branch's drawer vs what the report expects (P2, 0071).
// Reception counts today; a manager can correct an earlier day (the DB enforces both).
// Every count is kept (0073); the newest is the current one. Reception counts blind: no expected
// amount until their branch is counted (nightly S8/H11). onCounted tells the report which are done.
function CashCountPanel({
  day,
  branchIds,
  expected,
  onCounted,
}: {
  day: string
  branchIds: string[]
  expected: (branchId: string) => number
  onCounted: (branchIds: string[]) => void
}) {
  const { t } = useLanguage()
  const toast = useToast()
  const { profile } = useAuth()
  const { branchName, canWriteAt } = useBranch()
  const [counts, setCounts] = useState<Count[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const role = profile?.clinic_role
  const canEdit = role === 'manager' || (role === 'receptionist' && day === clinicDay())

  async function load() {
    const { data } = await supabase
      .from('cash_counts')
      .select('branch_id, counted, counted_at, counter:profiles!cash_counts_counted_by_fkey(full_name)')
      .eq('day', day)
      .in('branch_id', branchIds)
      .order('counted_at', { ascending: false })
    const rows = (data as Count[] | null) ?? []
    setCounts(rows)
    setDrafts({})
    onCounted([...new Set(rows.map((c) => c.branch_id))])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per day and branch set
  }, [day, branchIds.join()])

  async function save(branchId: string) {
    const value = parseFloat(drafts[branchId] ?? '')
    if (!(value >= 0) || !profile?.clinic_id) return
    setSaving(branchId)
    const { error } = await supabase
      .from('cash_counts')
      .insert({ clinic_id: profile.clinic_id, branch_id: branchId, day, counted: value })
    setSaving(null)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(t('reports.countSaved'))
    await load()
  }

  return (
    <div className="report-section cash-count-panel">
      <h3>{t('reports.countedCash')}</h3>
      <p className="report-note">{t('reports.countedCashHint')}</p>
      <ul className="record-list">
        {branchIds.map((id) => {
          const history = counts.filter((c) => c.branch_id === id)
          const count = history[0]
          const expectedCash = expected(id)
          const diff = count ? Math.round((count.counted - expectedCash) * 100) / 100 : null
          // Only your own branches can be counted (0076); others show their totals read-only.
          const canCount = canEdit && canWriteAt(id)
          const blind = role === 'receptionist' && canCount && !count
          return (
            <li key={id}>
              <div className="record-row">
                <div>
                  <strong>{branchName(id)}</strong>
                  {!blind && (
                    <div className="pet-owner">
                      {t('reports.expectedCash')}: <Ltr>{formatMoney(expectedCash)}</Ltr> {t('common.currency')}
                      {count && (
                        <>
                          {' · '}
                          {t('reports.countedCash')}: <Ltr>{formatMoney(count.counted)}</Ltr> · {t('reports.difference')}:{' '}
                          <strong className={diff === 0 ? 'cash-diff-ok' : 'cash-diff-off'}>
                            <Ltr>{`${diff! > 0 ? '+' : ''}${formatMoney(diff!)}`}</Ltr>
                          </strong>
                        </>
                      )}
                    </div>
                  )}
                  <div className="pet-owner">
                    {count
                      ? t('reports.countedBy', { name: count.counter?.full_name ?? '—', time: formatTime(count.counted_at) })
                      : t('reports.notCounted')}
                  </div>
                  {history.length > 1 && (
                    <div className="pet-owner">
                      {t('reports.recounted', { count: String(history.length - 1), amount: formatMoney(history[history.length - 1].counted) })}
                    </div>
                  )}
                </div>
                {canCount && (
                  <div className="record-actions">
                    <input
                      type="number"
                      inputMode="decimal"
                      className="no-spinner cash-count-input"
                      dir="ltr"
                      min="0"
                      step="0.01"
                      aria-label={`${t('reports.countedCash')} · ${branchName(id)}`}
                      value={drafts[id] ?? ''}
                      placeholder={count ? formatMoney(count.counted) : '0.00'}
                      onChange={(e) => setDrafts({ ...drafts, [id]: e.target.value })}
                    />
                    <button type="button" className="secondary-button" onClick={() => save(id)} disabled={saving === id || !drafts[id]}>
                      {saving === id ? t('common.saving') : t('common.save')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default CashCountPanel
