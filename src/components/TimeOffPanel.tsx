import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { clinicTimeToIso, isoToClinicFields } from '../lib/timeOff'
import { formatDateTime } from '../lib/format'
import Ltr from './Ltr'
import RequiredMark from './RequiredMark'
import { ListSkeleton } from './Skeleton'
import FormError from './FormError'

type TimeOff = Database['public']['Tables']['doctor_time_off']['Row']
type Draft = { reason: string; fromDate: string; fromTime: string; toDate: string; toTime: string }

// Defaults to tomorrow, the whole day, in clinic time.
function emptyDraft(): Draft {
  const tomorrow = isoToClinicFields(new Date(Date.now() + 86_400_000).toISOString()).date
  return { reason: '', fromDate: tomorrow, fromTime: '00:00', toDate: tomorrow, toTime: '23:59' }
}

// Managers only (the reason is readable by managers only, 0058). Lists current and upcoming entries.
function TimeOffPanel({ doctorId }: { doctorId: string }) {
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const [entries, setEntries] = useState<TimeOff[] | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error: loadError } = await supabase
      .from('doctor_time_off')
      .select('*')
      .eq('doctor_id', doctorId)
      .gt('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
    if (loadError) setError(loadError.message)
    setEntries(data ?? [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per doctor
  }, [doctorId])

  // How many bookings saving would move to Unassigned, before the manager commits.
  const [willMove, setWillMove] = useState<number | null>(null)
  useEffect(() => {
    setWillMove(null)
    if (!draft.fromDate || !draft.fromTime || !draft.toDate || !draft.toTime) return
    const starts = clinicTimeToIso(draft.fromDate, draft.fromTime)
    const ends = clinicTimeToIso(draft.toDate, draft.toTime)
    if (ends <= starts) return
    let stale = false
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('doctor_id', doctorId)
      .in('status', ['requested', 'confirmed', 'arrived'])
      .gte('scheduled_at', starts)
      .lt('scheduled_at', ends)
      .then(({ count }) => !stale && setWillMove(count ?? 0))
    return () => {
      stale = true
    }
  }, [doctorId, draft.fromDate, draft.fromTime, draft.toDate, draft.toTime])

  function startEditing(entry: TimeOff) {
    const from = isoToClinicFields(entry.starts_at)
    const to = isoToClinicFields(entry.ends_at)
    setEditingId(entry.id)
    setError(null)
    setDraft({ reason: entry.reason, fromDate: from.date, fromTime: from.time, toDate: to.date, toTime: to.time })
  }

  function stopEditing() {
    setEditingId(null)
    setError(null)
    setDraft(emptyDraft())
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    const starts = clinicTimeToIso(draft.fromDate, draft.fromTime)
    const ends = clinicTimeToIso(draft.toDate, draft.toTime)
    if (ends <= starts) {
      setError(t('timeOff.endBeforeStart'))
      return
    }
    setSaving(true)
    const { data: moved, error: saveError } = await supabase.rpc('save_doctor_time_off', {
      p_id: editingId,
      p_doctor: editingId ? null : doctorId,
      p_starts: starts,
      p_ends: ends,
      p_reason: draft.reason.trim(),
    })
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    toast.success(moved ? t('timeOff.savedMoved', { count: String(moved) }) : t('timeOff.saved'))
    stopEditing()
    await load()
  }

  async function handleDelete(entry: TimeOff) {
    if (!(await confirm(t('timeOff.deleteConfirm'), { danger: true, confirmLabel: t('common.delete') }))) return
    const { error: deleteError } = await supabase.from('doctor_time_off').delete().eq('id', entry.id)
    if (deleteError) {
      toast.error(deleteError.message)
      return
    }
    toast.success(t('timeOff.deleted'))
    if (editingId === entry.id) stopEditing()
    await load()
  }

  if (!entries) return <ListSkeleton rows={1} />

  return (
    <div className="staff-appointments time-off-panel">
      {entries.length === 0 ? (
        <p className="pet-owner">{t('timeOff.none')}</p>
      ) : (
        <ul className="record-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <div className="record-row">
                <div>
                  <strong>
                    <Ltr>
                      {formatDateTime(entry.starts_at)} – {formatDateTime(entry.ends_at)}
                    </Ltr>
                  </strong>
                  <div className="pet-owner">{entry.reason}</div>
                </div>
                <div className="record-actions">
                  <button type="button" className="secondary-button" onClick={() => startEditing(entry)}>
                    {t('common.edit')}
                  </button>
                  <button type="button" className="delete-button" onClick={() => handleDelete(entry)}>
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSave} className="pet-form">
        <h3>{editingId ? t('common.edit') : t('timeOff.add')}</h3>
        <p className="pet-owner">{t('timeOff.hint')}</p>
        <FormError message={error} />
        <label>
          {t('timeOff.reason')}
          <RequiredMark />
          <input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} required />
        </label>
        <label>
          {t('timeOff.from')}
          <RequiredMark />
          <div className="time-select" dir="ltr">
            <input type="date" value={draft.fromDate} onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })} required />
            <input type="time" value={draft.fromTime} onChange={(e) => setDraft({ ...draft, fromTime: e.target.value })} required />
          </div>
        </label>
        <label>
          {t('timeOff.to')}
          <RequiredMark />
          <div className="time-select" dir="ltr">
            <input type="date" value={draft.toDate} onChange={(e) => setDraft({ ...draft, toDate: e.target.value })} required />
            <input type="time" value={draft.toTime} onChange={(e) => setDraft({ ...draft, toTime: e.target.value })} required />
          </div>
        </label>
        {willMove !== null && (
          <p className={willMove > 0 ? 'form-warning' : 'pet-owner'} role="status">
            {t('timeOff.willMove', { count: String(willMove) })}
          </p>
        )}
        <div className="record-edit-actions">
          <button type="submit" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
          <button type="button" className="cancel-button" onClick={stopEditing}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </div>
  )
}

export default TimeOffPanel
