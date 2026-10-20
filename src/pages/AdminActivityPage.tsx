import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { auditActionLabelKey } from '../lib/adminAudit'
import LoadingScreen from '../components/LoadingScreen'
import Ltr from '../components/Ltr'
import { formatDateTime } from '../lib/format'

type AuditLogEntry = Database['public']['Tables']['admin_audit_log']['Row']

const ACTIVITY_LIMIT = 200

function AdminActivityPage() {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(ACTIVITY_LIMIT)
      setAuditLog(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  function auditActionLabel(action: string) {
    const key = auditActionLabelKey(action)
    return key ? t(key) : action
  }

  if (loading) return <LoadingScreen />

  return (
    <div>
      <h1>{t('admin.activityLog')}</h1>
      {auditLog.length === 0 ? (
        <p>{t('admin.noActivity')}</p>
      ) : (
        <ul className="pet-list">
          {auditLog.map((entry) => (
            <li key={entry.id} className="pet-list-item">
              <strong className="data-strong">{entry.actor_name}</strong> {auditActionLabel(entry.action)}
              {entry.target_label ? ` — ${entry.target_label}` : ''}
              <div className="record-date">
                <Ltr>{formatDateTime(entry.created_at)}</Ltr>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default AdminActivityPage
