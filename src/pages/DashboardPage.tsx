import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch, useBranchView } from '../lib/BranchContext'
import { ALL_BRANCHES } from '../lib/branchChoice'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { visitTypeLabel } from '../lib/visitTypes'
import { DUE_SOON_WINDOW_DAYS, addDays, vaccinationStatus } from '../lib/vaccination'
import { cancellationCategoryLabel, groupCancellationCounts } from '../lib/cancellation'
import { STATUS_LABEL_KEYS } from '../lib/appointmentStatus'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import VaccinationBadge from '../components/VaccinationBadge'
import RefreshButton from '../components/RefreshButton'
import BranchFilter from '../components/BranchFilter'
import { clinicDay, formatDate, formatMoney, formatTime } from '../lib/format'

type MedicalRecord = Database['public']['Tables']['medical_records']['Row'] & {
  pets: { name: string } | null
}
type TodayAppointment = {
  id: string
  scheduled_at: string
  status: string
  reason: string | null
  pets: { name: string; owner_name: string } | null
  doctor: { full_name: string } | null
}

type DueVaccine = { id: string; next_due_date: string; vaccine: { name: string } | null; pet: { id: string; name: string; owner_name: string } }

function DashboardPage() {
  const { profile } = useAuth()
  const { t, language } = useLanguage()
  const { isClinicManager } = useBranch()
  // Whole-clinic managers open on all branches, everyone else on the picked one; managers may switch.
  const [viewBranch, setViewBranch] = useBranchView(isClinicManager)
  const [today, setToday] = useState<TodayAppointment[]>([])
  const [paymentsToday, setPaymentsToday] = useState<number[]>([])
  const [recentRecords, setRecentRecords] = useState<MedicalRecord[]>([])
  const [vaccinationsDue, setVaccinationsDue] = useState<DueVaccine[]>([])
  const [cancellationCounts, setCancellationCounts] = useState<{ category: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const monthStart = new Date(dayStart)
    monthStart.setDate(1)

    // Pets and vaccinations stay clinic-wide (pets have no branch); appointments, money and
    // recent visits follow the branch filter (visits saved before phase 3 have no branch).
    const byBranch = <Q extends { eq: (column: 'branch_id', value: string) => Q }>(query: Q) =>
      viewBranch === ALL_BRANCHES ? query : query.eq('branch_id', viewBranch)
    const [todayRes, paymentsRes, recordsRes, petsRes, cancellationsRes] = await Promise.all([
      byBranch(
        supabase
          .from('appointments')
          .select('id, scheduled_at, status, reason, pets(name, owner_name), doctor:profiles!appointments_doctor_fkey(full_name)')
          .gte('scheduled_at', dayStart.toISOString())
          .lt('scheduled_at', dayEnd.toISOString()),
      ).order('scheduled_at', { ascending: true }),
      byBranch(
        supabase
          .from('invoice_payments')
          .select('amount')
          .gte('paid_at', dayStart.toISOString())
          .lt('paid_at', dayEnd.toISOString()),
      ),
      byBranch(supabase.from('medical_records').select('*, pets(name)'))
        .order('visit_date', { ascending: false })
        .limit(5),
      // One row per vaccine due (a pet with two due vaccines shows twice, each named).
      supabase
        .from('pet_vaccines')
        .select('id, next_due_date, vaccine:vaccines(name), pet:pets!inner(id, name, owner_name, deleted_at)')
        .is('pet.deleted_at', null)
        .lte('next_due_date', addDays(clinicDay(), DUE_SOON_WINDOW_DAYS))
        .order('next_due_date', { ascending: true }),
      byBranch(
        supabase
          .from('appointments')
          .select('cancellation_category')
          .eq('status', 'cancelled')
          .gte('scheduled_at', monthStart.toISOString()),
      ),
    ])
    setToday(todayRes.data ?? [])
    setPaymentsToday((paymentsRes.data ?? []).map((p) => p.amount))
    setRecentRecords(recordsRes.data ?? [])
    setVaccinationsDue((petsRes.data as DueVaccine[] | null) ?? [])
    setCancellationCounts(groupCancellationCounts((cancellationsRes.data ?? []).map((c) => c.cancellation_category)))
  }

  useEffect(() => {
    if (!profile?.clinic_id) {
      setLoading(false)
      return
    }
    load().then(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.clinic_id, viewBranch])

  async function handleRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  if (loading) return <LoadingScreen />

  if (!profile?.clinic_id) {
    return (
      <div>
        <h1>{t('dashboard.title')}</h1>
        <p>{t('dashboard.welcome')}</p>
      </div>
    )
  }

  const active = today.filter((a) => a.status !== 'cancelled')
  const done = active.filter((a) => a.status === 'completed').length
  const requested = active.filter((a) => a.status === 'requested')
  const toConfirm = requested.length
  const now = Date.now()
  // In-session visits are happening now, so "next" is the first one still waiting.
  const nextId = active.find(
    (a) => (a.status === 'requested' || a.status === 'confirmed') && new Date(a.scheduled_at).getTime() >= now,
  )?.id
  const overdue = vaccinationsDue.filter((due) => vaccinationStatus(due.next_due_date) === 'overdue').length
  const paymentsTotal = paymentsToday.reduce((sum, amount) => sum + amount, 0)
  // Latin digits in both languages, matching the rest of the app.
  const todayLabel = new Date().toLocaleDateString(language === 'ar' ? 'ar-u-nu-latn' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p className="page-subtitle">{todayLabel}</p>
        </div>
        <div className="page-header-actions">
          {profile.clinic_role === 'manager' && <BranchFilter value={viewBranch} onChange={setViewBranch} />}
          <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
        </div>
      </div>

      <div className="dash-stats">
        <Link to="/appointments" className="stat-tile stat-tile-link">
          <div className="stat-label">{t('dashboard.todayAppointments')}</div>
          <div className="stat-number" dir="ltr">
            {active.length}
          </div>
          <div className="stat-meta">{t('dashboard.doneLeft', { done: String(done), left: String(active.length - done) })}</div>
        </Link>
        <Link to={requested[0] ? `/appointments?open=${requested[0].id}` : '/appointments'} className="stat-tile stat-tile-link">
          <div className="stat-label">{t('dashboard.toConfirm')}</div>
          <div className="stat-number" dir="ltr">
            {toConfirm}
          </div>
          <div className="stat-meta">{t('dashboard.toConfirmHint')}</div>
        </Link>
        <Link to="/pets" className="stat-tile stat-tile-link">
          <div className="stat-label">{t('dashboard.vaccinationsDue')}</div>
          <div className="stat-number" dir="ltr">
            {vaccinationsDue.length}
          </div>
          <div className={`stat-meta${overdue > 0 ? ' stat-meta-danger' : ''}`}>
            {overdue > 0 ? t('dashboard.overdueCount', { count: String(overdue) }) : t('dashboard.noneOverdue')}
          </div>
        </Link>
        <Link to="/payments" className="stat-tile stat-tile-link">
          <div className="stat-label">{t('dashboard.todayPayments', { currency: t('common.currency') })}</div>
          <div className="stat-number" dir="ltr">
            {formatMoney(paymentsTotal)}
          </div>
          <div className="stat-meta">{t('dashboard.paymentCount', { count: String(paymentsToday.length) })}</div>
        </Link>
      </div>

      <div className="dash-columns">
        <section className="dash-panel">
          <div className="dash-panel-header">
            <h2>{t('dashboard.todaySchedule')}</h2>
            <Link to="/appointments" className="dash-panel-link">
              {t('dashboard.openCalendar')}
            </Link>
          </div>
          {today.length === 0 ? (
            <p className="dash-empty">{t('dashboard.noAppointmentsToday')}</p>
          ) : (
            <ul className="dash-list">
              {today.map((appt) => (
                <li key={appt.id}>
                  <Link
                    to={`/appointments?open=${appt.id}`}
                    className={`dash-row today-row${appt.id === nextId ? ' is-next' : ''}${
                      appt.status === 'completed' || appt.status === 'cancelled' ? ' is-past' : ''
                    }`}
                  >
                    <span className="today-time">
                      <Ltr>{formatTime(appt.scheduled_at)}</Ltr>
                      {appt.id === nextId && <span className="today-next">{t('dashboard.next')}</span>}
                    </span>
                    <span className="dash-row-main">
                      <strong>{appt.pets?.name ?? t('dashboard.unknownPet')}</strong>
                      <span className="dash-row-sub">
                        {[appt.pets?.owner_name, appt.reason].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="today-doctor">{appt.doctor?.full_name ?? t('calendar.unassigned')}</span>
                    <span className={`status-badge status-${appt.status}`}>
                      {STATUS_LABEL_KEYS[appt.status] ? t(STATUS_LABEL_KEYS[appt.status]) : appt.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="dash-side">
          <section className="dash-panel">
            <div className="dash-panel-header">
              <h2>{t('dashboard.vaccinationsDue')}</h2>
            </div>
            {vaccinationsDue.length === 0 ? (
              <p className="dash-empty">{t('dashboard.noneDue')}</p>
            ) : (
              <ul className="dash-list">
                {vaccinationsDue.map((due) => (
                  <li key={due.id}>
                    <Link to={`/pets/${due.pet.id}`} className="dash-row">
                      <span className="dash-row-main">
                        <strong>
                          {due.pet.name} · {due.vaccine?.name}
                        </strong>
                        <span className="dash-row-sub">
                          {due.pet.owner_name} · <Ltr>{formatDate(due.next_due_date)}</Ltr>
                        </span>
                      </span>
                      <VaccinationBadge nextDate={due.next_due_date} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dash-panel">
            <div className="dash-panel-header">
              <h2>{t('dashboard.recentMedicalRecords')}</h2>
            </div>
            {recentRecords.length === 0 ? (
              <p className="dash-empty">{t('dashboard.noMedicalRecords')}</p>
            ) : (
              <ul className="dash-list">
                {recentRecords.map((record) => (
                  <li key={record.id}>
                    <Link to={`/pets/${record.pet_id}`} className="dash-row">
                      <span className="dash-row-main">
                        <strong>{record.pets?.name ?? t('dashboard.unknownPet')}</strong>
                        <span className="dash-row-sub">
                          {record.visit_type && `${visitTypeLabel(t, record.visit_type)} · `}
                          <Ltr>{formatDate(record.visit_date)}</Ltr>
                          {record.diagnosis && ` · ${record.diagnosis}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {cancellationCounts.length > 0 && (
        <section className="dash-footer">
          <h2>{t('dashboard.cancellationsThisMonth')}</h2>
          <ul className="cancellation-counts">
            {cancellationCounts.map(({ category, count }) => (
              <li key={category}>
                <span>{cancellationCategoryLabel(t, category)}</span>
                <strong dir="ltr">{count}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default DashboardPage
