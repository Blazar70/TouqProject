import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { STATUS_LABEL_KEYS } from '../lib/appointmentStatus'
import Ltr from './Ltr'
import { ListSkeleton } from './Skeleton'

type Appointment = Database['public']['Tables']['appointments']['Row'] & {
  pets: { name: string } | null
}

const ARCHIVED_STATUSES = new Set(['completed', 'cancelled'])

function StaffAppointments({ staffId }: { staffId: string }) {
  const { t } = useLanguage()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [showPast, setShowPast] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('appointments')
      .select('*, pets(name)')
      .eq('assigned_staff_id', staffId)
      .order('scheduled_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setAppointments(data ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [staffId])

  if (loading) return <ListSkeleton rows={2} />

  const upcoming = appointments.filter((a) => !ARCHIVED_STATUSES.has(a.status))
  const past = appointments.filter((a) => ARCHIVED_STATUSES.has(a.status))

  return (
    <div className="staff-appointments">
      {upcoming.length === 0 ? (
        <p className="pet-owner">{t('staff.noneAssigned')}</p>
      ) : (
        <ul className="record-list">
          {upcoming.map((a) => (
            <li key={a.id}>
              <div className="record-row">
                <div>
                  <strong>{a.pets?.name ?? t('dashboard.unknownPet')}</strong> —{' '}
                  <Ltr>{new Date(a.scheduled_at).toLocaleString()}</Ltr>
                </div>
                <span className={`status-badge status-${a.status}`}>{t(STATUS_LABEL_KEYS[a.status])}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <div className="archive-section">
          <button type="button" className="secondary-button" onClick={() => setShowPast((v) => !v)}>
            {showPast ? t('appointments.hidePast') : t('appointments.showPast')} ({past.length})
          </button>
          {showPast && (
            <ul className="record-list">
              {past.map((a) => (
                <li key={a.id}>
                  <div className="record-row">
                    <div>
                      <strong>{a.pets?.name ?? t('dashboard.unknownPet')}</strong> —{' '}
                      <Ltr>{new Date(a.scheduled_at).toLocaleString()}</Ltr>
                    </div>
                    <span className={`status-badge status-${a.status}`}>{t(STATUS_LABEL_KEYS[a.status])}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default StaffAppointments
