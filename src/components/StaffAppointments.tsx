import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { STATUS_LABEL_KEYS } from '../lib/appointmentStatus'
import Ltr from './Ltr'
import { ListSkeleton } from './Skeleton'
import FormError from './FormError'
import { clinicDay, clinicMidnight, formatDateTime, formatTime, upcomingGroup } from '../lib/format'

type Appointment = Database['public']['Tables']['appointments']['Row'] & {
  pets: { name: string } | null
}

const ARCHIVED = '(completed,cancelled)'
// shortcut: each list stops at its limit (newest past, soonest upcoming), enough to plan cover; add paging if a manager needs more.
const LIST_LIMIT = 50

type Loaded = { upcoming: Appointment[]; notClosed: Appointment[]; past: Appointment[]; pastTotal: number }

function StaffAppointments({ staffId }: { staffId: string }) {
  const { t } = useLanguage()
  const [lists, setLists] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLists(null)
    setError(null)
    const today = clinicMidnight().toISOString()
    const mine = () => supabase.from('appointments').select('*, pets(name)', { count: 'exact' }).eq('doctor_id', staffId)
    // Separate limited queries (nightly B39): one list ordered oldest first lost every upcoming visit past the API's 1,000 rows.
    Promise.all([
      mine().not('status', 'in', ARCHIVED).gte('scheduled_at', today).order('scheduled_at').limit(LIST_LIMIT),
      mine().not('status', 'in', ARCHIVED).lt('scheduled_at', today).order('scheduled_at', { ascending: false }).limit(LIST_LIMIT),
      mine().filter('status', 'in', ARCHIVED).order('scheduled_at', { ascending: false }).limit(LIST_LIMIT),
    ]).then(([upcoming, notClosed, past]) => {
      if (cancelled) return
      const failed = upcoming.error ?? notClosed.error ?? past.error
      if (failed) setError(failed.message)
      setLists({ upcoming: upcoming.data ?? [], notClosed: notClosed.data ?? [], past: past.data ?? [], pastTotal: past.count ?? 0 })
    })
    return () => {
      cancelled = true
    }
  }, [staffId])

  if (!lists) return <ListSkeleton rows={2} />

  const { upcoming, notClosed, past, pastTotal } = lists
  const today = clinicDay()
  const groups = [
    { key: 'today', label: t('staff.groupToday') },
    { key: 'week', label: t('staff.groupWeek') },
    { key: 'later', label: t('staff.groupLater') },
  ].map((g) => ({ ...g, rows: upcoming.filter((a) => upcomingGroup(a.scheduled_at, today) === g.key) }))

  const list = (rows: Appointment[], timeOnly = false) => (
    <ul className="record-list">
      {rows.map((a) => (
        <li key={a.id}>
          <div className="record-row">
            <div>
              <strong>{a.pets?.name ?? t('dashboard.unknownPet')}</strong> —{' '}
              <Ltr>{timeOnly ? formatTime(a.scheduled_at) : formatDateTime(a.scheduled_at)}</Ltr>
            </div>
            <span className={`status-badge status-${a.status}`}>{t(STATUS_LABEL_KEYS[a.status])}</span>
          </div>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="staff-appointments">
      <FormError message={error} />
      {!error && upcoming.length === 0 && notClosed.length === 0 && <p className="pet-owner">{t('staff.noneAssigned')}</p>}

      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <div key={g.key}>
            <h4>{g.label}</h4>
            {list(g.rows, g.key === 'today')}
          </div>
        ))}

      {notClosed.length > 0 && (
        <>
          <h4>
            <span className="status-badge status-attention">{t('staff.groupNotClosed', { count: String(notClosed.length) })}</span>
          </h4>
          {list(notClosed)}
        </>
      )}

      {past.length > 0 && (
        <div className="archive-section">
          <button type="button" className="secondary-button" onClick={() => setShowPast((v) => !v)}>
            {showPast ? t('appointments.hidePast') : t('appointments.showPast')} ({pastTotal})
          </button>
          {showPast && (
            <>
              {pastTotal > past.length && <p className="pet-owner">{t('pets.resultCount', { count: String(past.length), total: String(pastTotal) })}</p>}
              {list(past)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default StaffAppointments
