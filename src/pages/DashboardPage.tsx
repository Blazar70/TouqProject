import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { visitTypeLabel } from '../lib/visitTypes'
import { DUE_SOON_WINDOW_DAYS, nextVaccinationDateAfterDose, vaccinationStatus } from '../lib/vaccination'
import { cancellationCategoryLabel, groupCancellationCounts } from '../lib/cancellation'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import VaccinationBadge from '../components/VaccinationBadge'
import RefreshButton from '../components/RefreshButton'
import { formatDate } from '../lib/format'

type MedicalRecord = Database['public']['Tables']['medical_records']['Row'] & {
  pets: { name: string } | null
}
type Pet = Database['public']['Tables']['pets']['Row']

function DashboardPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [upcomingCount, setUpcomingCount] = useState(0)
  const [recentRecords, setRecentRecords] = useState<MedicalRecord[]>([])
  const [vaccinationsDue, setVaccinationsDue] = useState<Pet[]>([])
  const [cancellationCounts, setCancellationCounts] = useState<{ category: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [upcomingRes, recordsRes, petsRes, cancellationsRes] = await Promise.all([
      supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .in('status', ['requested', 'confirmed']),
      supabase
        .from('medical_records')
        .select('*, pets(name)')
        .order('visit_date', { ascending: false })
        .limit(5),
      supabase
        .from('pets')
        .select('*')
        .is('deleted_at', null)
        .not('next_vaccination_date', 'is', null)
        // One day of slack for timezones; vaccinationStatus() below decides exactly.
        .lte('next_vaccination_date', nextVaccinationDateAfterDose(DUE_SOON_WINDOW_DAYS + 1))
        .order('next_vaccination_date', { ascending: true }),
      supabase
        .from('appointments')
        .select('cancellation_category')
        .eq('status', 'cancelled')
        .gte('scheduled_at', monthStart.toISOString()),
    ])
    setUpcomingCount(upcomingRes.count ?? 0)
    setRecentRecords(recordsRes.data ?? [])
    setVaccinationsDue(
      (petsRes.data ?? []).filter((pet) => {
        const status = vaccinationStatus(pet.next_vaccination_date)
        return status === 'due-soon' || status === 'overdue'
      }),
    )
    setCancellationCounts(groupCancellationCounts((cancellationsRes.data ?? []).map((c) => c.cancellation_category)))
  }

  useEffect(() => {
    if (!profile?.clinic_id) {
      setLoading(false)
      return
    }
    load().then(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.clinic_id])

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

  return (
    <div>
      <div className="page-header">
        <h1>{t('dashboard.title')}</h1>
        <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
      </div>

      <div className="stat-row">
        <Link to="/appointments" className="stat-tile stat-tile-link">
          <div className="stat-number" dir="ltr">
            {upcomingCount}
          </div>
          <div className="stat-label">{t('dashboard.upcomingAppointments')}</div>
        </Link>
      </div>

      <h2>{t('dashboard.vaccinationsDue')}</h2>
      {vaccinationsDue.length === 0 ? (
        <p>{t('dashboard.noneDue')}</p>
      ) : (
        <ul className="pet-list">
          {vaccinationsDue.map((pet) => (
            <li key={pet.id} className="pet-list-item">
              <div className="pet-row">
                <Link to="/pets" className="pet-row-toggle">
                  <strong>{pet.name}</strong>
                  {' — '}
                  <Ltr>{formatDate(pet.next_vaccination_date!)}</Ltr>
                </Link>
                <VaccinationBadge nextDate={pet.next_vaccination_date} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {cancellationCounts.length > 0 && (
        <>
          <h2>{t('dashboard.cancellationsThisMonth')}</h2>
          <ul className="cancellation-counts">
            {cancellationCounts.map(({ category, count }) => (
              <li key={category}>
                <span>{cancellationCategoryLabel(t, category)}</span>
                <strong dir="ltr">{count}</strong>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>{t('dashboard.recentMedicalRecords')}</h2>
      {recentRecords.length === 0 ? (
        <p>{t('dashboard.noMedicalRecords')}</p>
      ) : (
        <ul className="pet-list">
          {recentRecords.map((record) => (
            <li key={record.id} className="pet-list-item">
              <Link to={`/pets?highlight=${record.pet_id}`} className="pet-row-toggle">
                <strong>{record.pets?.name ?? t('dashboard.unknownPet')}</strong>
                {' — '}
                <Ltr>{formatDate(record.visit_date)}</Ltr>
                {record.visit_type && ` · ${visitTypeLabel(t, record.visit_type)}`}
                {record.diagnosis && <div className="pet-owner">{record.diagnosis}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default DashboardPage
