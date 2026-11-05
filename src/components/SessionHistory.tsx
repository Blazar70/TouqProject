import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Database } from '../lib/database.types'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { visitTypeLabel } from '../lib/visitTypes'
import { prescriptionText, toPrescription } from '../lib/clinicalFields'
import { formatDate } from '../lib/format'
import Ltr from './Ltr'

type MedicalRecord = Database['public']['Tables']['medical_records']['Row'] & { vet: { full_name: string } | null }

// The pet's last visits beside the session form, so the doctor sees history without leaving.
// Under 1200 px it is a bar above the form (H68), closed so the form stays in reach.
function SessionHistory({ petId, appointmentId }: { petId: string; appointmentId: string }) {
  const { t } = useLanguage()
  const [records, setRecords] = useState<MedicalRecord[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let stale = false
    setRecords(null)
    setFailed(false)
    supabase
      .from('medical_records')
      .select('*, vet:profiles!medical_records_vet_id_fkey(full_name)')
      .eq('pet_id', petId)
      // Not this visit's own half-written record; a plain neq would also hide old records with no appointment.
      .or(`appointment_id.is.null,appointment_id.neq.${appointmentId}`)
      .order('visit_date', { ascending: false })
      .limit(5)
      .then(({ data, error }) => {
        if (stale) return
        // "No earlier visits" must only ever mean that: a failed load says so (B41).
        if (error) setFailed(true)
        else setRecords(data ?? [])
      })
    return () => {
      stale = true
    }
  }, [petId, appointmentId, attempt])

  const title = records?.length ? t('session.historyCount', { count: String(records.length) }) : t('session.history')

  return (
    <aside className="session-history" aria-labelledby="session-history-title">
      <h2 id="session-history-title">
        <button type="button" className="session-history-toggle" aria-expanded={open || failed} onClick={() => setOpen((o) => !o)}>
          {title}
          <ChevronDown size={18} aria-hidden />
        </button>
        <span className="session-history-heading">{title}</span>
      </h2>
      <div className={open || failed ? undefined : 'session-history-closed'}>
        {failed ? (
          <div role="alert">
            <p className="form-error">{t('session.historyFailed')}</p>
            <button type="button" className="secondary-button" onClick={() => setAttempt((n) => n + 1)}>
              {t('common.tryAgain')}
            </button>
          </div>
        ) : records === null ? (
          <p className="pet-owner">{t('common.loading')}</p>
        ) : records.length === 0 ? (
          <p className="pet-owner">{t('session.noHistory')}</p>
        ) : (
          <ul className="record-list">
            {records.map((record) => (
              <li key={record.id}>
                <strong>
                  <Ltr>{formatDate(record.visit_date)}</Ltr>
                  {record.visit_type && ` · ${visitTypeLabel(t, record.visit_type)}`}
                </strong>
                {record.vet && <div className="pet-owner">{record.vet.full_name}</div>}
                {record.weight_kg !== null && (
                  <div className="pet-owner">
                    {t('clinical.weightKg')}: <Ltr>{record.weight_kg}</Ltr>
                  </div>
                )}
                {record.diagnosis && <div className="pet-owner">{record.diagnosis}</div>}
                {record.treatment && <div className="pet-owner">{record.treatment}</div>}
                {toPrescription(record.prescription).length > 0 && (
                  <div className="pet-owner record-field">{prescriptionText(toPrescription(record.prescription))}</div>
                )}
                <Link to={`/pets/${petId}?record=${record.id}`} className="tap-link">
                  {t('session.viewVisit')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

export default SessionHistory
