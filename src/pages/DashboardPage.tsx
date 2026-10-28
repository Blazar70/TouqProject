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
import { STATUS_LABEL_KEYS, nextAppointmentId } from '../lib/appointmentStatus'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import VaccinationBadge from '../components/VaccinationBadge'
import RefreshButton from '../components/RefreshButton'
import BranchFilter from '../components/BranchFilter'
import { clinicDay, clinicMidnight, formatDate, formatMoney, formatTime } from '../lib/format'

type MedicalRecord = Database['public']['Tables']['medical_records']['Row'] & {
  pets: { name: string } | null
}
type TodayAppointment = {
  id: string
  scheduled_at: string
  status: string
  arrived_at: string | null
  reason: string | null
  doctor_id: string | null
  pets: { name: string; owner_name: string } | null
  doctor: { full_name: string } | null
}

const MINE_KEY = 'touq-dashboard-mine'

type DueVaccine = { id: string; next_due_date: string; vaccine: { name: string } | null; pet: { id: string; name: string; owner_name: string } }

function DashboardPage() {
  const { profile, handlesMoney } = useAuth()
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
  // Ticks once a minute so "waiting 18 min" stays true (nightly H12/H19).
  const [now, setNow] = useState(() => Date.now())
  // Doctors open on their own patients (U32); the choice sticks per device.
  const isDoctor = profile?.clinic_role === 'doctor'
  const [mineChoice, setMineChoice] = useState(() => {
    try {
      return localStorage.getItem(MINE_KEY) !== 'branch'
    } catch {
      return true
    }
  })
  const mine = isDoctor && mineChoice

  function chooseMine(value: boolean) {
    setMineChoice(value)
    try {
      localStorage.setItem(MINE_KEY, value ? 'mine' : 'branch')
    } catch {
      // Blocked storage: the choice still holds for this page load.
    }
  }

  async function load() {
    // Clinic days, not the device clock (nightly B4): matches the cash-up report.
    const dayStart = clinicMidnight()
    const dayEnd = new Date(dayStart.getTime() + 86_400_000)
    const monthStart = clinicMidnight(`${clinicDay().slice(0, 8)}01`)

    // Pets and vaccinations stay clinic-wide (pets have no branch); appointments, money and
    // recent visits follow the branch filter (visits saved before phase 3 have no branch).
    const byBranch = <Q extends { eq: (column: 'branch_id', value: string) => Q }>(query: Q) =>
      viewBranch === ALL_BRANCHES ? query : query.eq('branch_id', viewBranch)
    const recordsQuery = supabase.from('medical_records').select('*, pets(name)')
    const [todayRes, paymentsRes, recordsRes, petsRes, cancellationsRes] = await Promise.all([
      byBranch(
        supabase
          .from('appointments')
          .select('id, scheduled_at, status, arrived_at, reason, doctor_id, pets(name, owner_name), doctor:profiles!appointments_doctor_fkey(full_name)')
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
      byBranch(mine ? recordsQuery.eq('vet_id', profile?.id ?? '') : recordsQuery)
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
    // A failed (e.g. offline) background reload keeps the last good lists instead of emptying them.
    if ([todayRes, paymentsRes, recordsRes, petsRes, cancellationsRes].some((r) => r.error)) return
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
  }, [profile?.clinic_id, viewBranch, mine])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Tablets stay on this page all day: reload quietly every 2 minutes and when the tab comes back (nightly H31).
  // shortcut: polling, not Realtime; switch to a Supabase Realtime subscription on appointments if 2 min is too slow.
  useEffect(() => {
    if (!profile?.clinic_id) return
    const reload = () => {
      if (document.visibilityState !== 'visible') return
      setNow(Date.now())
      load()
    }
    const timer = setInterval(reload, 120_000)
    document.addEventListener('visibilitychange', reload)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', reload)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.clinic_id, viewBranch, mine])

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

  // "waiting 18 min · arrived 10:42 · " first in the line (it is what a doctor scans for), amber from 20 minutes.
  const waitingNote = (a: TodayAppointment) => {
    if (a.status !== 'arrived' || !a.arrived_at) return null
    const minutes = Math.max(0, Math.floor((now - Date.parse(a.arrived_at)) / 60_000))
    return (
      <>
        <span className={`dash-waiting${minutes >= 20 ? ' is-long' : ''}`}>{t('dashboard.waiting', { count: String(minutes) })}</span>
        {' · '}
        {t('appointments.arrivedAt', { time: formatTime(a.arrived_at) })}
        {' · '}
      </>
    )
  }

  const mineToday = today.filter((a) => a.doctor_id === profile.id)
  const shown = mine ? mineToday : today
  const active = shown.filter((a) => a.status !== 'cancelled')
  const done = active.filter((a) => a.status === 'completed').length
  const requested = active.filter((a) => a.status === 'requested')
  const toConfirm = requested.length
  // A doctor's "Next" is always one of their own, also in the branch view.
  const nextId = nextAppointmentId(isDoctor ? mineToday : today, Date.now())
  const nextAppt = today.find((a) => a.id === nextId) ?? null
  const overdue = vaccinationsDue.filter((due) => vaccinationStatus(due.next_due_date) === 'overdue').length
  const paymentsTotal = paymentsToday.reduce((sum, amount) => sum + amount, 0)
  // Latin digits in both languages, matching the rest of the app.
  const todayLabel = new Date().toLocaleDateString(language === 'ar' ? 'ar-u-nu-latn' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Riyadh',
  })

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p className="page-subtitle">{todayLabel}</p>
        </div>
        <div className="page-header-actions">
          {isDoctor && (
            <div className="method-toggle" role="group" aria-label={t('dashboard.showPatients')}>
              <button type="button" aria-pressed={mine} className={`secondary-button${mine ? ' method-toggle-active' : ''}`} onClick={() => chooseMine(true)}>
                {t('dashboard.myPatients')}
              </button>
              <button type="button" aria-pressed={!mine} className={`secondary-button${mine ? '' : ' method-toggle-active'}`} onClick={() => chooseMine(false)}>
                {t('dashboard.wholeBranch')}
              </button>
            </div>
          )}
          {profile.clinic_role === 'manager' && <BranchFilter value={viewBranch} onChange={setViewBranch} />}
          <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
        </div>
      </div>

      {/* One quiet strip, not four cards: the schedule below is what the eye should land on. */}
      <nav className="dash-strip" aria-label={t('dashboard.atAGlance')}>
        <Link to="/appointments" className="dash-strip-item">
          <span className="dash-strip-label">{t('dashboard.todayAppointments')}</span>
          <span className="dash-strip-number" dir="ltr">
            {active.length}
          </span>
          <span className="stat-meta">{t('dashboard.doneLeft', { done: String(done), left: String(active.length - done) })}</span>
        </Link>
        <Link to={requested[0] ? `/appointments?open=${requested[0].id}` : '/appointments'} className="dash-strip-item">
          <span className="dash-strip-label">{t('dashboard.toConfirm')}</span>
          <span className={`dash-strip-number${toConfirm > 0 ? ' dash-strip-attention' : ''}`} dir="ltr">
            {toConfirm}
          </span>
          <span className="stat-meta">{t('dashboard.toConfirmHint')}</span>
        </Link>
        <Link to="/pets" className="dash-strip-item">
          <span className="dash-strip-label">{t('dashboard.vaccinationsDue')}</span>
          <span className="dash-strip-number" dir="ltr">
            {vaccinationsDue.length}
          </span>
          <span className={`stat-meta${overdue > 0 ? ' stat-meta-danger' : ''}`}>
            {overdue > 0 ? t('dashboard.overdueCount', { count: String(overdue) }) : t('dashboard.noneOverdue')}
          </span>
        </Link>
        {handlesMoney && (
          <Link to="/payments" className="dash-strip-item">
            <span className="dash-strip-label">{t('dashboard.todayPayments', { currency: t('common.currency') })}</span>
            <span className="dash-strip-number" dir="ltr">
              {formatMoney(paymentsTotal)}
            </span>
            <span className="stat-meta">{t('dashboard.paymentCount', { count: String(paymentsToday.length) })}</span>
          </Link>
        )}
      </nav>

      <div className="dash-columns">
        <section className="dash-panel">
          <div className="dash-panel-header">
            <h2>{t('dashboard.todaySchedule')}</h2>
            <Link to="/appointments" className="dash-panel-link">
              {t('dashboard.openCalendar')}
            </Link>
          </div>
          {nextAppt && (
            <Link
              to={`/appointments?open=${nextAppt.id}`}
              className="dash-next"
              aria-label={t('dashboard.nextUpLabel', {
                name: nextAppt.pets?.name ?? t('dashboard.unknownPet'),
                time: formatTime(nextAppt.scheduled_at),
                status: STATUS_LABEL_KEYS[nextAppt.status] ? t(STATUS_LABEL_KEYS[nextAppt.status]) : nextAppt.status,
              })}
            >
              <span className="dash-next-label">{t('dashboard.nextUp')}</span>
              <span className="dash-next-time">
                <Ltr>{formatTime(nextAppt.scheduled_at)}</Ltr>
              </span>
              <span className="dash-next-main">
                <strong>{nextAppt.pets?.name ?? t('dashboard.unknownPet')}</strong>
                <span className="dash-row-sub">
                  {waitingNote(nextAppt)}
                  {[nextAppt.pets?.owner_name, nextAppt.reason].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="dash-next-side">
                <span className="today-doctor">{nextAppt.doctor?.full_name ?? t('calendar.unassigned')}</span>
                <span className={`status-badge status-${nextAppt.status}`}>
                  {STATUS_LABEL_KEYS[nextAppt.status] ? t(STATUS_LABEL_KEYS[nextAppt.status]) : nextAppt.status}
                </span>
              </span>
            </Link>
          )}
          {shown.length === 0 ? (
            <p className="dash-empty">{t(mine ? 'dashboard.noPatientsToday' : 'dashboard.noAppointmentsToday')}</p>
          ) : shown.every((appt) => appt.id === nextAppt?.id) ? (
            <p className="dash-empty">{t('dashboard.nothingElseToday')}</p>
          ) : (
            <ul className="dash-list">
              {/* The next one is in the "Next up" banner above; the list holds the rest of the day. */}
              {shown.filter((appt) => appt.id !== nextAppt?.id).map((appt) => (
                <li key={appt.id}>
                  <Link
                    to={`/appointments?open=${appt.id}`}
                    className={`dash-row today-row${appt.status === 'completed' || appt.status === 'cancelled' ? ' is-past' : ''}`}
                  >
                    <span className="today-time">
                      <Ltr>{formatTime(appt.scheduled_at)}</Ltr>
                    </span>
                    <span className="dash-row-main">
                      <strong>{appt.pets?.name ?? t('dashboard.unknownPet')}</strong>
                      <span className="dash-row-sub">
                        {waitingNote(appt)}
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
