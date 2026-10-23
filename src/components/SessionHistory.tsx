import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../lib/database.types'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { visitTypeLabel } from '../lib/visitTypes'
import { formatDate } from '../lib/format'
import Ltr from './Ltr'

type MedicalRecord = Database['public']['Tables']['medical_records']['Row']

// The pet's last visits beside the session form, so the doctor sees history without leaving.
function SessionHistory({ petId }: { petId: string }) {
  const { t } = useLanguage()
  const [records, setRecords] = useState<MedicalRecord[] | null>(null)

  useEffect(() => {
    supabase
      .from('medical_records')
      .select('*')
      .eq('pet_id', petId)
      .order('visit_date', { ascending: false })
      .limit(5)
      .then(({ data }) => setRecords(data ?? []))
  }, [petId])

  return (
    <aside className="session-history" aria-labelledby="session-history-title">
      <h2 id="session-history-title">{t('session.history')}</h2>
      {records === null ? (
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
              {record.weight_kg !== null && (
                <div className="pet-owner">
                  {t('clinical.weightKg')}: <Ltr>{record.weight_kg}</Ltr>
                </div>
              )}
              {record.diagnosis && <div className="pet-owner">{record.diagnosis}</div>}
              {record.treatment && <div className="pet-owner">{record.treatment}</div>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

export default SessionHistory
