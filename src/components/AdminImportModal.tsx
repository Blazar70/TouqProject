import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import { downloadCsv } from '../lib/csvExport'
import { IMPORT_COLUMNS, buildImport, decodeCsv, parseCsv } from '../lib/csvImport'
import type { ImportError, ImportRow } from '../lib/csvImport'
import Modal from './Modal'
import FormError from './FormError'
import Ltr from './Ltr'
import { formatDate } from '../lib/format'

// Admin > clinic > Import owners & pets (0097): pick a CSV, check the preview, import all or nothing.
function AdminImportModal({ clinicId, clinicName, onClose }: { clinicId: string; clinicName: string; onClose: () => void }) {
  const { t } = useLanguage()
  const toast = useToast()
  const [parsed, setParsed] = useState<{ file: string; rows: ImportRow[]; errors: ImportError[] } | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Rows the import left out as "already there" (nightly H43): the admin can download and check them.
  const [skipped, setSkipped] = useState<ImportRow[] | null>(null)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setError(null)
    if (!file) return setParsed(null)
    const { rows, errors } = buildImport(parseCsv(decodeCsv(await file.arrayBuffer())))
    setParsed({ file: file.name, rows, errors })
  }

  async function handleImport() {
    if (!parsed) return
    setImporting(true)
    const { data, error: importError } = await supabase.rpc('admin_import_owners_pets', { p_clinic: clinicId, p_rows: parsed.rows })
    setImporting(false)
    if (importError) return setError(importError.message)
    const result = data as unknown as { pets: number; new_owners: number; matched_owners: number; skipped: number; skipped_rows: number[] }
    const counts = { pets: String(result.pets), newOwners: String(result.new_owners), matched: String(result.matched_owners), skipped: String(result.skipped) }
    toast.success(t(result.skipped ? 'import.doneSkipped' : 'import.done', counts))
    if (!result.skipped) return onClose()
    setSkipped(result.skipped_rows.map((n) => parsed.rows[n - 1]))
    setParsed(null)
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
      {skipped && (
        <div className="import-skipped">
          <p>{t('import.skippedExplain', { count: String(skipped.length) })}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => downloadCsv('touq-import-already-there.csv', [...IMPORT_COLUMNS], skipped.map((r) => IMPORT_COLUMNS.map((c) => r[c])))}
          >
            {t('import.downloadSkipped')}
          </button>
        </div>
      )}
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
        <>
          <p>{t('import.preview', { pets: String(parsed.rows.length), owners: String(owners) })}</p>
          {/* First rows as they will be saved: garbled letters, swapped columns or a misread date show here (nightly H37). */}
          <div className="import-preview">
            <table>
              <caption>{t('import.firstRows')}</caption>
              <thead>
                <tr>
                  <th>{t('import.colOwner')}</th>
                  <th>{t('import.colPhone')}</th>
                  <th>{t('import.colPet')}</th>
                  <th>{t('import.colSpecies')}</th>
                  <th>{t('import.colBirth')}</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td>{r.owner_name}</td>
                    <td><Ltr>{r.owner_phone}</Ltr></td>
                    <td>{r.pet_name}</td>
                    <td>{r.species}</td>
                    <td>{r.date_of_birth && formatDate(r.date_of_birth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <FormError message={error} />
      <div className="record-edit-actions">
        {!skipped && (
          <button type="button" className="primary-button" onClick={handleImport} disabled={!parsed || parsed.errors.length > 0 || importing}>
            {importing ? t('common.saving') : t('import.run')}
          </button>
        )}
        <button type="button" className="cancel-button" onClick={onClose}>
          {skipped ? t('common.close') : t('common.cancel')}
        </button>
      </div>
    </Modal>
  )
}

export default AdminImportModal
