import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { clinicDay, formatDate } from '../lib/format'
import VaccinationBadge from './VaccinationBadge'
import Ltr from './Ltr'
import FormError from './FormError'

type Pet = Database['public']['Tables']['pets']['Row']
type Vaccine = Database['public']['Tables']['vaccines']['Row']
type Schedule = Database['public']['Tables']['pet_vaccines']['Row'] & { vaccine: { name: string } | null }
type Dose = Database['public']['Tables']['vaccine_doses']['Row'] & {
  pet_vaccine: { pet_id: string; vaccine: { name: string } | null } | null
  giver: { full_name: string } | null
}
type Draft = { vaccineId: string; nextDue: string; intervalDays: string }

const DOSE_SELECT =
  '*, pet_vaccine:pet_vaccines!inner(pet_id, vaccine:vaccines(name)), giver:profiles!vaccine_doses_given_by_fkey(full_name)'

// One schedule per vaccine (names from the clinic list in Settings, 0067). "Mark given"
// records a dose and moves the due date; the latest dose of each vaccine can be undone.
function VaccinationPanel({ pet, onUpdated }: { pet: Pet; onUpdated: (pet: Pet) => void }) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const isVet = profile?.role === 'vet'
  // Reception sees what is due but doesn't record doses (0075).
  const canGiveDose = ['doctor', 'nurse', 'manager'].includes(profile?.clinic_role ?? '')

  const [vaccines, setVaccines] = useState<Vaccine[]>([])
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [doses, setDoses] = useState<Dose[]>([])
  // null = no form; '' = adding; an id = editing that schedule.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ vaccineId: '', nextDue: '', intervalDays: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [v, s, d] = await Promise.all([
      supabase.from('vaccines').select('*').order('name'),
      supabase.from('pet_vaccines').select('*, vaccine:vaccines(name)').eq('pet_id', pet.id).order('next_due_date'),
      supabase.from('vaccine_doses').select(DOSE_SELECT).eq('pet_vaccine.pet_id', pet.id).order('created_at', { ascending: false }).limit(20),
    ])
    const loadError = v.error ?? s.error ?? d.error
    if (loadError) setError(loadError.message)
    setVaccines(v.data ?? [])
    setSchedules((s.data as Schedule[]) ?? [])
    setDoses((d.data as Dose[]) ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per pet
  }, [pet.id])

  // The pets list badge reads pets.next_vaccination_date, which the DB keeps in step.
  async function afterChange() {
    await load()
    const { data } = await supabase.from('pets').select('*').eq('id', pet.id).single()
    if (data) onUpdated(data)
  }

  function startAdd() {
    const first = vaccines.find((v) => !schedules?.some((s) => s.vaccine_id === v.id))
    setDraft({ vaccineId: first?.id ?? '', nextDue: clinicDay(), intervalDays: first ? String(first.interval_days) : '' })
    setError(null)
    setEditing('')
  }

  function startEdit(schedule: Schedule) {
    setDraft({ vaccineId: schedule.vaccine_id, nextDue: schedule.next_due_date, intervalDays: String(schedule.interval_days) })
    setError(null)
    setEditing(schedule.id)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    const interval = parseInt(draft.intervalDays, 10)
    if (!(interval >= 1 && interval <= 3650)) {
      setError(t('vaccination.invalidDays'))
      return
    }
    setBusy(true)
    const { error: saveError } = editing
      ? await supabase.from('pet_vaccines').update({ next_due_date: draft.nextDue, interval_days: interval }).eq('id', editing)
      : await supabase.from('pet_vaccines').insert({
          clinic_id: pet.clinic_id,
          pet_id: pet.id,
          vaccine_id: draft.vaccineId,
          next_due_date: draft.nextDue,
          interval_days: interval,
        })
    setBusy(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setEditing(null)
    toast.success(t('vaccination.scheduleSaved'))
    await afterChange()
  }

  async function handleRemove(schedule: Schedule) {
    const ok = await confirm(t('vaccination.removeConfirm', { name: schedule.vaccine?.name ?? '' }), {
      danger: true,
      confirmLabel: t('common.delete'),
    })
    if (!ok) return
    const { error: deleteError } = await supabase.from('pet_vaccines').delete().eq('id', schedule.id)
    if (deleteError) {
      toast.error(deleteError.message)
      return
    }
    await afterChange()
  }

  async function handleMarkGiven(schedule: Schedule) {
    setBusy(true)
    const { data: nextDue, error: rpcError } = await supabase.rpc('mark_vaccine_given', { p_pet_vaccine: schedule.id })
    setBusy(false)
    if (rpcError) {
      toast.error(rpcError.message)
      return
    }
    toast.success(t('vaccination.markedGivenNext', { name: schedule.vaccine?.name ?? '', date: formatDate(nextDue) }))
    await afterChange()
  }

  async function handleUndo(dose: Dose) {
    const { error: rpcError } = await supabase.rpc('undo_vaccine_dose', { p_dose: dose.id })
    if (rpcError) {
      toast.error(rpcError.message)
      return
    }
    toast.success(t('vaccination.doseUndone'))
    await afterChange()
  }

  // Doses come newest first: the first one seen per schedule is the undoable one.
  const latestDoseIds = new Set<string>()
  const seen = new Set<string>()
  for (const dose of doses) {
    if (!seen.has(dose.pet_vaccine_id)) latestDoseIds.add(dose.id)
    seen.add(dose.pet_vaccine_id)
  }
  const available = vaccines.filter((v) => editing !== '' || !schedules?.some((s) => s.vaccine_id === v.id))

  return (
    <div className="vaccination-panel">
      <div className="panel-header">
        <h3>{t('vaccination.title')}</h3>
        {isVet && editing === null && vaccines.length > 0 && (
          <button type="button" className="secondary-button" onClick={startAdd}>
            + {t('vaccination.addVaccine')}
          </button>
        )}
      </div>

      <FormError message={error} />

      {schedules === null ? null : schedules.length === 0 ? (
        <p className="pet-owner">{vaccines.length === 0 ? t('vaccination.noVaccinesInClinic') : t('vaccination.statusNone')}</p>
      ) : (
        <ul className="record-list">
          {schedules.map((schedule) => (
            <li key={schedule.id}>
              <div className="record-row">
                <div>
                  <strong>{schedule.vaccine?.name}</strong> <VaccinationBadge nextDate={schedule.next_due_date} />
                  <div className="pet-owner">
                    {t('vaccination.nextDue')}: <Ltr>{formatDate(schedule.next_due_date)}</Ltr> ·{' '}
                    {t('vaccination.everyDays', { count: String(schedule.interval_days) })}
                  </div>
                </div>
                {isVet && (
                  <div className="record-actions">
                    {canGiveDose && (
                      <button type="button" className="secondary-button" onClick={() => handleMarkGiven(schedule)} disabled={busy}>
                        {t('vaccination.markGivenShort')}
                      </button>
                    )}
                    <button type="button" className="secondary-button" onClick={() => startEdit(schedule)}>
                      {t('common.edit')}
                    </button>
                    <button type="button" className="delete-button" onClick={() => handleRemove(schedule)}>
                      {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isVet && editing !== null && (
        <form onSubmit={handleSave} className="pet-form">
          <label>
            {t('vaccination.vaccine')}
            <select
              value={draft.vaccineId}
              onChange={(e) => {
                const picked = vaccines.find((v) => v.id === e.target.value)
                setDraft({ ...draft, vaccineId: e.target.value, intervalDays: picked ? String(picked.interval_days) : draft.intervalDays })
              }}
              disabled={editing !== ''}
              required
            >
              {available.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('vaccination.nextDate')}
            <input type="date" dir="ltr" value={draft.nextDue} onChange={(e) => setDraft({ ...draft, nextDue: e.target.value })} required />
          </label>
          <label>
            {t('vaccination.repeatDays')}
            <input
              type="number"
              dir="ltr"
              min={1}
              max={3650}
              value={draft.intervalDays}
              onChange={(e) => setDraft({ ...draft, intervalDays: e.target.value })}
              required
            />
          </label>
          <div className="record-edit-actions">
            <button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="cancel-button" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {doses.length > 0 && (
        <>
          <h4 className="vaccination-history-title">{t('vaccination.history')}</h4>
          <ul className="record-list">
            {doses.map((dose) => (
              <li key={dose.id}>
                <div className="record-row">
                  <div>
                    <Ltr>{formatDate(dose.given_on)}</Ltr> · {dose.pet_vaccine?.vaccine?.name}
                    {dose.giver && <span className="pet-owner"> · {dose.giver.full_name}</span>}
                  </div>
                  {canGiveDose && latestDoseIds.has(dose.id) && (
                    <button type="button" className="secondary-button" onClick={() => handleUndo(dose)}>
                      {t('vaccination.undo')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default VaccinationPanel
