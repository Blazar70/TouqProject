import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import LoadingScreen from '../components/LoadingScreen'
import ActivityList from '../components/ActivityList'

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

  if (loading) return <LoadingScreen />

  return (
    <div>
      <div className="page-header">
        <h1>{t('admin.activityLog')}</h1>
      </div>
      <ActivityList entries={auditLog} />
    </div>
  )
}

export default AdminActivityPage
