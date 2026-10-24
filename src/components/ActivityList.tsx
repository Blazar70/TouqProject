import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { auditActionLabelKey } from '../lib/adminAudit'
import Ltr from './Ltr'
import { formatDateTime } from '../lib/format'

type AuditLogEntry = Database['public']['Tables']['admin_audit_log']['Row']

// The activity log table: admin Activity page (every clinic) and the Manager page (own clinic, 0080).
function ActivityList({ entries }: { entries: AuditLogEntry[] }) {
  const { t } = useLanguage()

  function auditActionLabel(action: string) {
    const key = auditActionLabelKey(action)
    return key ? t(key) : action
  }

  if (entries.length === 0) return <p className="empty-state">{t('admin.noActivity')}</p>
  return (
    <ul className="pet-list data-table data-activity">
      <li className="data-head" aria-hidden>
        <span>{t('admin.activityWho')}</span>
        <span>{t('admin.activityWhat')}</span>
        <span>{t('admin.activityTarget')}</span>
        <span>{t('admin.activityWhen')}</span>
      </li>
      {entries.map((entry) => (
        <li key={entry.id} className="pet-list-item">
          <div className="pet-row data-row">
            <strong className="data-strong">{entry.actor_name}</strong>
            <span>{auditActionLabel(entry.action)}</span>
            <span className="data-cell-wide">{entry.target_label}</span>
            <span className="data-muted data-num">
              <Ltr>{formatDateTime(entry.created_at)}</Ltr>
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default ActivityList
