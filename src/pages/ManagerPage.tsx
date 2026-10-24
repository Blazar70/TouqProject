import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch, useBranchView } from '../lib/BranchContext'
import { ALL_BRANCHES } from '../lib/branchChoice'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { clinicDay, clinicMidnight, formatDate, formatMoney } from '../lib/format'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import RefreshButton from '../components/RefreshButton'
import BranchFilter from '../components/BranchFilter'
import ActivityList from '../components/ActivityList'
import FormError from '../components/FormError'

type Fn = Database['public']['Functions']
type AuditLogEntry = Database['public']['Tables']['admin_audit_log']['Row']
type Overview = {
  today: Fn['report_income_branches']['Returns']
  month: Fn['report_income_branches']['Returns']
  unpaid: Fn['report_unpaid']['Returns']
  cash: Fn['report_cash_differences']['Returns']
  visits: { doctor: string; count: number }[]
  activity: AuditLogEntry[]
}

const ACTIVITY_LIMIT = 50
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

// Managers' overview (pinned "Manager page"): money and work numbers for this month plus the clinic's
// activity log. Staff accounts stay on the Staff page; the full reports stay on Reports.
function ManagerPage() {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const { isClinicManager, branchName } = useBranch()
  // Whole-clinic managers open on all branches; branch managers only ever see their own (BranchFilter mine).
  const [viewBranch, setViewBranch] = useBranchView(isClinicManager)
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    const today = clinicDay()
    const monthStart = `${today.slice(0, 8)}01`
    const branch = viewBranch === ALL_BRANCHES ? null : viewBranch
    let visitsQuery = supabase
      .from('appointments')
      .select('doctor:profiles!appointments_doctor_fkey(full_name)')
      .eq('status', 'completed')
      .gte('scheduled_at', clinicMidnight(monthStart).toISOString())
    if (branch) visitsQuery = visitsQuery.eq('branch_id', branch)
    // RLS gives the log to whole-clinic managers only (0080); skip the call for the rest.
    const activityQuery = isClinicManager
      ? supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(ACTIVITY_LIMIT)
      : Promise.resolve({ data: [] as AuditLogEntry[], error: null })
    const [todayRes, monthRes, unpaidRes, cashRes, visitsRes, activityRes] = await Promise.all([
      supabase.rpc('report_income_branches', { p_from: today, p_to: today, p_branch: branch }),
      supabase.rpc('report_income_branches', { p_from: monthStart, p_to: today, p_branch: branch }),
      supabase.rpc('report_unpaid', { p_branch: branch }),
      supabase.rpc('report_cash_differences', { p_from: monthStart, p_to: today, p_branch: branch }),
      // shortcut: counts in the browser and PostgREST returns at most 1000 rows; move to SQL past ~1000 visits a month.
      visitsQuery,
      activityQuery,
    ])
    const failed = [todayRes, monthRes, unpaidRes, cashRes, visitsRes, activityRes].find((r) => r.error)
    if (failed) {
      setError(t('reports.loadError'))
      return
    }
    const byDoctor = new Map<string, number>()
    for (const v of (visitsRes.data as { doctor: { full_name: string } | null }[] | null) ?? []) {
      const name = v.doctor?.full_name ?? t('calendar.unassigned')
      byDoctor.set(name, (byDoctor.get(name) ?? 0) + 1)
    }
    setError(null)
    setData({
      today: todayRes.data ?? [],
      month: monthRes.data ?? [],
      unpaid: unpaidRes.data ?? [],
      cash: cashRes.data ?? [],
      visits: [...byDoctor].map(([doctor, count]) => ({ doctor, count })).sort((a, b) => b.count - a.count),
      activity: activityRes.data ?? [],
    })
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

  if (profile?.clinic_role !== 'manager') return null
  if (!data && !error) return <LoadingScreen />

  const currency = t('common.currency')
  const offDays = data?.cash.filter((c) => c.difference !== 0) ?? []

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1>{t('manager.title')}</h1>
          <p className="page-subtitle">{t(isClinicManager ? 'manager.subtitle' : 'manager.subtitleBranch')}</p>
        </div>
        <div className="page-header-actions">
          <BranchFilter value={viewBranch} onChange={setViewBranch} mine />
          <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
        </div>
      </div>

      <FormError message={error} />

      {data && (
        <>
          <div className="dash-stats">
            <Link to="/reports" className="stat-tile stat-tile-link">
              <div className="stat-label">{t('manager.collectedToday', { currency })}</div>
              <div className="stat-number" dir="ltr">{formatMoney(sum(data.today.map((r) => r.collected)))}</div>
              <div className="stat-meta">{t('manager.invoicedNet', { amount: formatMoney(sum(data.today.map((r) => r.net))) })}</div>
            </Link>
            <Link to="/reports" className="stat-tile stat-tile-link">
              <div className="stat-label">{t('manager.collectedMonth', { currency })}</div>
              <div className="stat-number" dir="ltr">{formatMoney(sum(data.month.map((r) => r.collected)))}</div>
              <div className="stat-meta">{t('manager.invoicedNet', { amount: formatMoney(sum(data.month.map((r) => r.net))) })}</div>
            </Link>
            <Link to="/reports" className="stat-tile stat-tile-link">
              <div className="stat-label">{t('manager.unpaid', { currency })}</div>
              <div className="stat-number" dir="ltr">{formatMoney(sum(data.unpaid.map((r) => r.remaining)))}</div>
              <div className="stat-meta">{t('manager.unpaidCount', { count: String(data.unpaid.length) })}</div>
            </Link>
            <div className="stat-tile">
              <div className="stat-label">{t('manager.cashOff')}</div>
              <div className="stat-number" dir="ltr">{offDays.length}</div>
              <div className={`stat-meta${offDays.length ? ' stat-meta-danger' : ''}`}>
                {t('manager.cashCounts', { count: String(data.cash.length) })}
              </div>
            </div>
          </div>

          <div className="dash-columns">
            <section className="dash-panel">
              <div className="dash-panel-header">
                <h2>{t('manager.visitsByDoctor')}</h2>
              </div>
              {data.visits.length === 0 ? (
                <p className="dash-empty">{t('manager.noVisits')}</p>
              ) : (
                <ul className="dash-list">
                  {data.visits.map((v) => (
                    <li key={v.doctor} className="dash-row">
                      <span className="dash-row-main">
                        <strong>{v.doctor}</strong>
                      </span>
                      <span className="data-num" dir="ltr">{v.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="dash-panel">
              <div className="dash-panel-header">
                <h2>{t('manager.cashThisMonth')}</h2>
                <Link to="/reports" className="dash-panel-link">
                  {t('nav.reports')}
                </Link>
              </div>
              {data.cash.length === 0 ? (
                <p className="dash-empty">{t('manager.noCashCounts')}</p>
              ) : (
                <ul className="dash-list">
                  {data.cash.map((c) => (
                    <li key={`${c.day}-${c.branch_id}`} className="dash-row">
                      <span className="dash-row-main">
                        <strong>
                          <Ltr>{formatDate(c.day)}</Ltr>
                          {viewBranch === ALL_BRANCHES && ` · ${branchName(c.branch_id)}`}
                        </strong>
                        <span className="dash-row-sub">
                          {t('manager.countedVsExpected', { counted: formatMoney(c.counted), expected: formatMoney(c.expected) })}
                          {c.counts > 1 && ` · ${t('manager.recounts', { count: String(c.counts - 1) })}`}
                        </span>
                      </span>
                      <strong className={c.difference === 0 ? 'cash-diff-ok' : 'cash-diff-off'}>
                        <Ltr>{`${c.difference > 0 ? '+' : ''}${formatMoney(c.difference)}`}</Ltr>
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {isClinicManager && (
            <section className="manager-activity">
              <div className="panel-header">
                <h2>{t('manager.activity')}</h2>
              </div>
              <ActivityList entries={data.activity} />
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default ManagerPage
