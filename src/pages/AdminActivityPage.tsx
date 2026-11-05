import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageSkeleton } from '../components/Skeleton'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { AUDIT_ACTION_LABEL_KEYS } from '../lib/adminAudit'
import ActivityList from '../components/ActivityList'
import FormError from '../components/FormError'

type AuditLogEntry = Database['public']['Tables']['admin_audit_log']['Row']

const ACTIVITY_LIMIT = 200

function AdminActivityPage() {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [clinics, setClinics] = useState<{ id: string; name: string }[]>([])
  const [clinicId, setClinicId] = useState('')
  const [action, setAction] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loadedOnce, setLoadedOnce] = useState(false)

  async function fetchPage(before?: string) {
    let query = supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(ACTIVITY_LIMIT)
    if (clinicId) query = query.eq('clinic_id', clinicId)
    if (action) query = query.eq('action', action)
    if (before) query = query.lt('created_at', before)
    return query
  }

  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)
    fetchPage().then(({ data, error: loadError }) => {
      if (stale) return
      // A failed load must not read as "no activity" (B43).
      if (loadError) setError(loadError.message)
      else {
        setAuditLog(data ?? [])
        setHasOlder((data ?? []).length === ACTIVITY_LIMIT)
      }
      setLoading(false)
      setLoadedOnce(true)
    })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, action, attempt])

  useEffect(() => {
    supabase
      .from('clinics')
      .select('id, name')
      .order('name')
      .then(({ data }) => setClinics(data ?? []))
  }, [])

  async function loadOlder() {
    setLoadingOlder(true)
    setError(null)
    const { data, error: loadError } = await fetchPage(auditLog[auditLog.length - 1].created_at)
    if (loadError) setError(loadError.message)
    else {
      setAuditLog((current) => [...current, ...(data ?? [])])
      setHasOlder((data ?? []).length === ACTIVITY_LIMIT)
    }
    setLoadingOlder(false)
  }

  // Only the first load: on a filter change the filters must stay on screen and keep focus.
  if (loading && !loadedOnce) return <PageSkeleton title={t('admin.activityLog')} />

  const actionOptions = Object.entries(AUDIT_ACTION_LABEL_KEYS)
    .map(([value, key]) => ({ value, label: t(key) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const failedFirstLoad = Boolean(error) && auditLog.length === 0

  return (
    <div>
      <div className="page-header">
        <h1>{t('admin.activityLog')}</h1>
      </div>
      <div className="activity-filters">
        <label>
          {t('admin.activityClinic')}
          <select value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
            <option value="">{t('admin.activityAllClinics')}</option>
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.activityWhat')}
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t('admin.activityAllActions')}</option>
            {actionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FormError message={error} />
      {failedFirstLoad ? (
        <button type="button" className="secondary-button" onClick={() => setAttempt((n) => n + 1)}>
          {t('common.tryAgain')}
        </button>
      ) : (
        <>
          <ActivityList entries={auditLog} />
          {hasOlder && (
            <div className="activity-older">
              <p className="pet-owner">{t('admin.activityShowing', { total: String(auditLog.length) })}</p>
              <button type="button" className="secondary-button" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? t('common.loading') : t('admin.activityLoadOlder')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default AdminActivityPage
