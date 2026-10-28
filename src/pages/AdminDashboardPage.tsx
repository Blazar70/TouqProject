import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { billingDueState } from '../lib/billingDue'
import LoadingScreen from '../components/LoadingScreen'
import SimpleBarChart from '../components/SimpleBarChart'
import Ltr from '../components/Ltr'
import { clinicMidnight, formatDate, formatMoney } from '../lib/format'

type Payment = Database['public']['Tables']['payments']['Row']
type ClinicStub = { id: string; name: string; deleted_at: string | null }

const DORMANT_WINDOW_DAYS = 30
const CHART_WEEKS = 8

function AdminDashboardPage() {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [clinics, setClinics] = useState<ClinicStub[]>([])
  const [counts, setCounts] = useState<{ clinic_id: string; pets: number; appointments: number; staff: number }[]>([])
  const [branches, setBranches] = useState<{ clinic_id: string }[]>([])
  const [disabledStaff, setDisabledStaff] = useState(0)
  const [appointmentsRaw, setAppointmentsRaw] = useState<{ clinic_id: string; created_at: string }[]>([])
  const [unpaid, setUnpaid] = useState<Payment[]>([])

  useEffect(() => {
    async function load() {
      // shortcut: a window with >1000 rows is still capped by PostgREST, move it into SQL if that happens.
      const day = 24 * 60 * 60 * 1000
      const appointmentsSince = new Date(Date.now() - Math.max(DORMANT_WINDOW_DAYS, CHART_WEEKS * 7) * day).toISOString()
      const [clinicsRes, countsRes, branchesRes, disabledRes, appointmentsRes, paymentsRes] = await Promise.all([
        supabase.from('clinics').select('id, name, deleted_at'),
        supabase.rpc('admin_clinic_counts'),
        supabase.from('branches').select('clinic_id').eq('active', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'vet').eq('disabled', true),
        supabase.from('appointments').select('clinic_id, created_at').gte('created_at', appointmentsSince),
        supabase.from('payments').select('*').in('status', ['pending', 'overdue']).order('due_date', { ascending: true }),
      ])
      setClinics(clinicsRes.data ?? [])
      setCounts(countsRes.data ?? [])
      setBranches(branchesRes.data ?? [])
      setDisabledStaff(disabledRes.count ?? 0)
      setAppointmentsRaw(appointmentsRes.data ?? [])
      setUnpaid(paymentsRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const liveClinicIds = useMemo(() => new Set(clinics.filter((c) => !c.deleted_at).map((c) => c.id)), [clinics])
  const clinicNameById = useMemo(() => Object.fromEntries(clinics.map((c) => [c.id, c.name])), [clinics])

  const totals = useMemo(() => {
    const live = counts.filter((c) => liveClinicIds.has(c.clinic_id))
    const sum = (key: 'pets' | 'appointments' | 'staff') => live.reduce((n, c) => n + c[key], 0)
    return { pets: sum('pets'), appointments: sum('appointments'), staff: sum('staff') }
  }, [counts, liveClinicIds])

  const branchCount = branches.filter((b) => liveClinicIds.has(b.clinic_id)).length

  const { activeClinicCount, dormantClinicCount } = useMemo(() => {
    const cutoff = Date.now() - DORMANT_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const activeClinicIds = new Set(
      appointmentsRaw.filter((a) => new Date(a.created_at).getTime() >= cutoff).map((a) => a.clinic_id),
    )
    return {
      activeClinicCount: activeClinicIds.size,
      dormantClinicCount: Math.max(0, liveClinicIds.size - activeClinicIds.size),
    }
  }, [appointmentsRaw, liveClinicIds])

  const weeklyChartData = useMemo(() => {
    // Weeks end at the clinic's midnight, not the device's (Riyadh has no DST, so 7-day steps stay on midnight).
    const now = clinicMidnight().getTime()
    const week = 7 * 24 * 60 * 60 * 1000
    const weeks: { label: string; value: number; start: number; end: number }[] = []
    for (let i = CHART_WEEKS - 1; i >= 0; i--) {
      const end = now - i * week
      const start = end - week
      weeks.push({
        label: new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' }),
        value: 0,
        start,
        end,
      })
    }
    for (const a of appointmentsRaw) {
      const t = new Date(a.created_at).getTime()
      const bucket = weeks.find((w) => t >= w.start && t < w.end)
      if (bucket) bucket.value += 1
    }
    return weeks.map(({ label, value }) => ({ label, value }))
  }, [appointmentsRaw])

  // Overdue first; the query already sorts by due date.
  const billingDue = useMemo(
    () =>
      unpaid
        .map((payment) => ({ payment, state: billingDueState(payment) }))
        .filter((row) => row.state !== null)
        .sort((a, b) => (a.state === b.state ? 0 : a.state === 'overdue' ? -1 : 1)),
    [unpaid],
  )

  if (loading) return <LoadingScreen />

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>{t('nav.dashboard')}</h1>
      </div>

      <div className="dash-stats dash-stats-5">
        <Link to="/clinics" className="stat-tile stat-tile-link">
          <div className="stat-label">{t('admin.clinics')}</div>
          <div className="stat-number" dir="ltr">
            {liveClinicIds.size}
          </div>
          <div className="stat-meta">
            {t('admin.activeDormant', { active: String(activeClinicCount), dormant: String(dormantClinicCount) })}
          </div>
        </Link>
        <div className="stat-tile">
          <div className="stat-label">{t('admin.branchesField')}</div>
          <div className="stat-number" dir="ltr">
            {branchCount}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">{t('nav.staff')}</div>
          <div className="stat-number" dir="ltr">
            {totals.staff}
          </div>
          <div className="stat-meta">{t('admin.disabledCount', { count: String(disabledStaff) })}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">{t('nav.pets')}</div>
          <div className="stat-number" dir="ltr">
            {totals.pets}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">{t('nav.appointments')}</div>
          <div className="stat-number" dir="ltr">
            {totals.appointments}
          </div>
        </div>
      </div>

      <div className="dash-columns">
        <section className="dash-panel">
          <div className="dash-panel-header">
            <h2>{t('admin.usageDashboard')}</h2>
            <span className="dash-panel-meta">{t('admin.appointmentsPerWeek')}</span>
          </div>
          <div className="dash-panel-body">
            <SimpleBarChart data={weeklyChartData} />
          </div>
        </section>

        <section className="dash-panel">
          <div className="dash-panel-header">
            <h2>{t('admin.billingDue')}</h2>
            <Link to="/billing" className="dash-panel-link">
              {t('admin.openBilling')}
            </Link>
          </div>
          {billingDue.length === 0 ? (
            <p className="dash-empty">{t('admin.billingDueNone')}</p>
          ) : (
            <ul className="dash-list">
              {billingDue.map(({ payment, state }) => (
                <li key={payment.id}>
                  <Link to="/billing" className="dash-row">
                    <span className="dash-row-main">
                      <strong>{clinicNameById[payment.clinic_id] ?? '—'}</strong>
                      <span className="dash-row-sub">
                        <Ltr>{formatMoney(payment.amount)}</Ltr> {t('common.currency')}
                        {payment.due_date && (
                          <>
                            {' · '}
                            {t('admin.paymentDueDate')}: <Ltr>{formatDate(payment.due_date)}</Ltr>
                          </>
                        )}
                      </span>
                    </span>
                    <span className={`status-badge ${state === 'overdue' ? 'status-cancelled' : 'status-requested'}`}>
                      {t(state === 'overdue' ? 'billingStatus.overdue' : 'admin.dueSoon')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

export default AdminDashboardPage
