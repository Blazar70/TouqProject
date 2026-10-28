import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import { downloadCsv } from '../lib/csvExport'
import { IMPORT_COLUMNS, buildImport, parseCsv } from '../lib/csvImport'
import type { ImportError, ImportRow } from '../lib/csvImport'
import Modal from './Modal'
import FormError from './FormError'

// Admin > clinic > Import owners & pets (0097): pick a CSV, check the preview, import all or nothing.
function AdminImportModal({ clinicId, clinicName, onClose }: { clinicId: string; clinicName: string; onClose: () => void }) {
  const { t } = useLanguage()
  const toast = useToast()
  const [parsed, setParsed] = useState<{ file: string; rows: ImportRow[]; errors: ImportError[] } | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setError(null)
    if (!file) return setParsed(null)
    const { rows, errors } = buildImport(parseCsv(await file.text()))
    setParsed({ file: file.name, rows, errors })
  }

  async function handleImport() {
    if (!parsed) return
    setImporting(true)
    const { data, error: importError } = await supabase.rpc('admin_import_owners_pets', { p_clinic: clinicId, p_rows: parsed.rows })
    setImporting(false)
    if (importError) return setError(importError.message)
    const result = data as unknown as { pets: number; new_owners: number; matched_owners: number }
    toast.success(t('import.done', { pets: String(result.pets), newOwners: String(result.new_owners), matched: String(result.matched_owners) }))
    onClose()
  }

  // Same phone = same owner; a row without a phone is its own owner (as in 0097).
  const owners = parsed ? new Set(parsed.rows.map((r) => r.owner_phone).filter(Boolean)).size + parsed.rows.filter((r) => !r.owner_phone).length : 0

  return (
    <Modal onClose={onClose} labelledBy="admin-import-title">
      <h2 id="admin-import-title">
        {t('import.title')} — {clinicName}
      </h2>
      <p className="pet-owner">{t('import.hint')}</p>
      <button type="button" className="secondary-button" onClick={() => downloadCsv('touq-import-template.csv', [...IMPORT_COLUMNS], [])}>
        {t('import.template')}
      </button>
      <label>
        {t('import.file')}
        <input type="file" accept=".csv,text/csv" onChange={handleFile} />
      </label>
      {parsed && parsed.errors.length > 0 && (
        <div role="alert">
          <p className="form-error">{t('import.fixFirst', { count: String(parsed.errors.length) })}</p>
          <ul className="record-list">
            {parsed.errors.slice(0, 50).map((err, i) => (
              <li key={i}>{t('import.lineError', { line: String(err.line), problem: t(err.key) })}</li>
            ))}
          </ul>
        </div>
      )}
      {parsed && parsed.errors.length === 0 && (
        <p>{t('import.preview', { pets: String(parsed.rows.length), owners: String(owners) })}</p>
      )}
      <FormError message={error} />
      <div className="record-edit-actions">
        <button type="button" className="primary-button" onClick={handleImport} disabled={!parsed || parsed.errors.length > 0 || importing}>
          {importing ? t('common.saving') : t('import.run')}
        </button>
        <button type="button" className="cancel-button" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  )
}

export default AdminImportModal
