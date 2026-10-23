import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import FormError from './FormError'
import RequiredMark from './RequiredMark'

type Vaccine = Database['public']['Tables']['vaccines']['Row']

// The clinic's vaccine list (0067): staff pick from it on a pet; managers keep it.
function VaccinesSettings({ clinicId, canEdit }: { clinicId: string; canEdit: boolean }) {
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const [vaccines, setVaccines] = useState<Vaccine[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [intervalDays, setIntervalDays] = useState('365')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error: loadError } = await supabase.from('vaccines').select('*').order('name')
    if (loadError) setError(loadError.message)
    setVaccines(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  function reset() {
    setEditingId(null)
    setName('')
    setIntervalDays('365')
    setError(null)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    const days = parseInt(intervalDays, 10)
    if (!(days >= 1 && days <= 3650)) {
      setError(t('vaccination.invalidDays'))
      return
    }
    setSaving(true)
    const values = { name: name.trim(), interval_days: days }
    const { error: saveError } = editingId
      ? await supabase.from('vaccines').update(values).eq('id', editingId)
      : await supabase.from('vaccines').insert({ ...values, clinic_id: clinicId })
    setSaving(false)
    if (saveError) {
      setError(saveError.code === '23505' ? t('vaccination.nameTaken') : saveError.message)
      return
    }
    toast.success(t('vaccination.vaccineSaved', { name: values.name }))
    reset()
    await load()
  }

  async function handleDelete(vaccine: Vaccine) {
    if (!(await confirm(t('vaccination.deleteVaccineConfirm', { name: vaccine.name }), { danger: true, confirmLabel: t('common.delete') }))) return
    const { error: deleteError } = await supabase.from('vaccines').delete().eq('id', vaccine.id)
    if (deleteError) {
      toast.error(deleteError.code === '23503' ? t('vaccination.vaccineInUse', { name: vaccine.name }) : deleteError.message)
      return
    }
    if (editingId === vaccine.id) reset()
    await load()
  }

  if (!vaccines) return <p>{t('common.loading')}</p>

  return (
    <>
      {vaccines.length === 0 ? (
        <p className="pet-owner">{t('vaccination.noVaccinesInClinic')}</p>
      ) : (
        <ul className="record-list">
          {vaccines.map((vaccine) => (
            <li key={vaccine.id}>
              <div className="record-row">
                <div>
                  <strong>{vaccine.name}</strong>
                  <div className="pet-owner">{t('vaccination.everyDays', { count: String(vaccine.interval_days) })}</div>
                </div>
                {canEdit && (
                  <div className="record-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditingId(vaccine.id)
                        setName(vaccine.name)
                        setIntervalDays(String(vaccine.interval_days))
                        setError(null)
                      }}
                    >
                      {t('common.edit')}
                    </button>
                    <button type="button" className="delete-button" onClick={() => handleDelete(vaccine)}>
                      {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={handleSave} className="pet-form">
          <FormError message={error} />
          <label>
            {t('vaccination.vaccine')}
            <RequiredMark />
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            {t('vaccination.repeatDays')}
            <RequiredMark />
            <input type="number" dir="ltr" min={1} max={3650} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} required />
          </label>
          <div className="record-edit-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('common.saving') : editingId ? t('common.save') : `+ ${t('vaccination.addToList')}`}
            </button>
            {editingId && (
              <button type="button" className="cancel-button" onClick={reset}>
                {t('common.cancel')}
              </button>
            )}
          </div>
        </form>
      )}
    </>
  )
}

export default VaccinesSettings
