import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import VaccinationBadge from './VaccinationBadge'
import { REPEAT_INTERVAL_OPTIONS, vaccinationStatus, nextVaccinationDateAfterDose } from '../lib/vaccination'
import Ltr from './Ltr'
import { useToast } from '../lib/ToastContext'
import { formatDate } from '../lib/format'

type Pet = Database['public']['Tables']['pets']['Row']

const NO_REPEAT = 'none'
const CUSTOM = 'custom'

function repeatSelectValue(intervalDays: number | null) {
  if (!intervalDays) return NO_REPEAT
  const isPreset = REPEAT_INTERVAL_OPTIONS.some((opt) => opt.days === intervalDays)
  return isPreset ? String(intervalDays) : CUSTOM
}

function VaccinationPanel({ pet, onUpdated }: { pet: Pet; onUpdated: (pet: Pet) => void }) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const toast = useToast()
  const isVet = profile?.role === 'vet'

  const [showForm, setShowForm] = useState(false)
  const [dueDate, setDueDate] = useState(pet.next_vaccination_date ?? '')
  const [repeatDays, setRepeatDays] = useState(repeatSelectValue(pet.vaccination_interval_days))
  const [customDays, setCustomDays] = useState(
    repeatSelectValue(pet.vaccination_interval_days) === CUSTOM ? String(pet.vaccination_interval_days) : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)

    let intervalDays: number | null = null
    if (repeatDays === CUSTOM) {
      const parsed = parseInt(customDays, 10)
      if (!parsed || parsed < 1) {
        setError(t('vaccination.invalidDays'))
        return
      }
      intervalDays = parsed
    } else if (repeatDays !== NO_REPEAT) {
      intervalDays = parseInt(repeatDays, 10)
    }

    setSaving(true)
    const { data, error } = await supabase
      .from('pets')
      .update({
        next_vaccination_date: dueDate || null,
        vaccination_interval_days: intervalDays,
      })
      .eq('id', pet.id)
      .select()
      .single()

    if (error || !data) {
      setError(error?.message ?? t('common.couldNotSave'))
      setSaving(false)
      return
    }

    onUpdated(data)
    setSaving(false)
    setShowForm(false)
    toast.success(t('vaccination.scheduleSaved'))
  }

  async function handleMarkGiven() {
    if (!pet.vaccination_interval_days) return
    const nextDateStr = nextVaccinationDateAfterDose(pet.vaccination_interval_days)

    setSaving(true)
    setError(null)
    const { data, error } = await supabase
      .from('pets')
      .update({ next_vaccination_date: nextDateStr })
      .eq('id', pet.id)
      .select()
      .single()

    if (error || !data) {
      setError(error?.message ?? t('common.couldNotSave'))
      setSaving(false)
      return
    }

    onUpdated(data)
    setSaving(false)
    toast.success(t('vaccination.markedGiven'))
  }

  const status = vaccinationStatus(pet.next_vaccination_date)

  return (
    <div className="vaccination-panel">
      <div className="panel-header">
        <h3>{t('vaccination.title')}</h3>
        {isVet && !showForm && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setDueDate(pet.next_vaccination_date ?? '')
              const initial = repeatSelectValue(pet.vaccination_interval_days)
              setRepeatDays(initial)
              setCustomDays(initial === CUSTOM ? String(pet.vaccination_interval_days) : '')
              setShowForm(true)
            }}
          >
            {pet.next_vaccination_date ? t('vaccination.editSchedule') : t('vaccination.setSchedule')}
          </button>
        )}
      </div>

      <VaccinationBadge nextDate={pet.next_vaccination_date} />
      {pet.next_vaccination_date && (
        <p className="pet-owner">
          {t('vaccination.nextDue')}: <Ltr>{formatDate(pet.next_vaccination_date)}</Ltr>
        </p>
      )}

      {error && <p className="form-error">{error}</p>}

      {isVet && (status === 'due-soon' || status === 'overdue') && pet.vaccination_interval_days && (
        <button type="button" className="secondary-button" onClick={handleMarkGiven} disabled={saving}>
          {saving ? t('common.saving') : t('vaccination.markGiven')}
        </button>
      )}

      {isVet && showForm && (
        <form onSubmit={handleSave} className="pet-form">
          <label>
            {t('vaccination.nextDate')}
            <input type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </label>
          <label>
            {t('vaccination.repeat')}
            <select value={repeatDays} onChange={(e) => setRepeatDays(e.target.value)}>
              <option value={NO_REPEAT}>{t('vaccination.doesNotRepeat')}</option>
              {REPEAT_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.days} value={opt.days}>
                  {t(opt.labelKey)}
                </option>
              ))}
              <option value={CUSTOM}>{t('vaccination.other')}</option>
            </select>
          </label>
          {repeatDays === CUSTOM && (
            <label>
              {t('vaccination.customInterval')}
              <div className="custom-interval">
                <span>{t('vaccination.every')}</span>
                <input
                  type="number"
                  dir="ltr"
                  min={1}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  required
                />
                <span>{t('vaccination.days')}</span>
              </div>
            </label>
          )}
          <div className="record-edit-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="cancel-button" onClick={() => setShowForm(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default VaccinationPanel
