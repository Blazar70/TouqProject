import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { formatDateTime, formatTime } from '../lib/format'
import { clinicTimeToIso, isoToClinicFields } from '../lib/timeOff'
import { toLatinDigits } from '../lib/arabicDigits'
import { OVERDUE_AFTER_MS } from '../lib/inpatient'
import Ltr from './Ltr'
import FormError from './FormError'

type Task = Database['public']['Tables']['inpatient_tasks']['Row']
type Slot = Database['public']['Functions']['inpatient_task_slots']['Returns'][number]

const HOUR = 3_600_000
const toIso = (local: string) => clinicTimeToIso(...(local.split('T') as [string, string]))
const toLocal = (iso: string) => {
  const { date, time } = isoToClinicFields(iso)
  return `${date}T${time}`
}

// Medication/check reminders of an open stay (0082): "every N hours from a start". Due times come
// from inpatient_task_slots(), the same function the push job uses. Doctors and managers add and
// stop; doctors, nurses and managers tick doses (whoever ticked, or a manager, can undo).
function InpatientReminders({ stayId }: { stayId: string }) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const role = profile?.clinic_role ?? ''
  const canManage = ['doctor', 'manager'].includes(role)
  const canTick = ['doctor', 'nurse', 'manager'].includes(role)

  // null until loaded, so "No reminders" never flashes before the list.
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ label: '', everyHours: '8', start: '', end: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const now = Date.now()
    const [taskRes, slotRes] = await Promise.all([
      supabase.from('inpatient_tasks').select('*').eq('stay_id', stayId).is('stopped_at', null).order('created_at'),
      supabase.rpc('inpatient_task_slots', { p_from: new Date(now - 24 * HOUR).toISOString(), p_to: new Date(now + 24 * HOUR).toISOString() }),
    ])
    const loadError = taskRes.error ?? slotRes.error
    if (loadError) return setError(loadError.message)
    setTasks(taskRes.data ?? [])
    setSlots((slotRes.data ?? []).filter((s) => s.stay_id === stayId))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per stay
  }, [stayId])

  function startAdding() {
    // Next full hour, in clinic time.
    setDraft({ label: '', everyHours: '8', start: toLocal(new Date(Math.ceil(Date.now() / HOUR) * HOUR).toISOString()), end: '' })
    setAdding(true)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!profile?.clinic_id) return
    setBusy(true)
    setError(null)
    const { error: addError } = await supabase.from('inpatient_tasks').insert({
      clinic_id: profile.clinic_id,
      stay_id: stayId,
      label: draft.label.trim(),
      every_hours: Number(toLatinDigits(draft.everyHours)),
      starts_at: toIso(draft.start),
      ends_at: draft.end ? toIso(draft.end) : null,
    })
    setBusy(false)
    if (addError) return setError(addError.message)
    setAdding(false)
    load()
  }

  async function handleStop(task: Task) {
    if (!(await confirm(t('reminders.stopConfirm', { label: task.label }), { confirmLabel: t('reminders.stop') }))) return
    const { error: stopError } = await supabase.from('inpatient_tasks').update({ stopped_at: new Date().toISOString() }).eq('id', task.id)
    if (stopError) return toast.error(stopError.message)
    load()
  }

  async function handleDone(slot: Slot) {
    if (!profile?.clinic_id) return
    const { error: doneError } = await supabase.from('inpatient_task_doses').insert({ clinic_id: profile.clinic_id, task_id: slot.task_id, due_at: slot.due_at })
    if (doneError) return toast.error(doneError.message)
    load()
  }

  async function handleUndo(slot: Slot) {
    const { data: gone, error: undoError } = await supabase.from('inpatient_task_doses').delete().eq('task_id', slot.task_id).eq('due_at', slot.due_at).select('id')
    if (undoError || !gone?.length) return toast.error(undoError?.message ?? t('errors.noPermission'))
    load()
  }

  if (tasks === null) return null
  const now = Date.now()

  return (
    <div className="inpatient-reminders">
      <div className="panel-header">
        <h4>{t('reminders.title')}</h4>
        {canManage && !adding && (
          <button type="button" className="secondary-button" onClick={startAdding}>
            + {t('reminders.add')}
          </button>
        )}
      </div>

      <FormError message={error} />

      {adding && (
        <form onSubmit={handleAdd} className="pet-form">
          <label>
            {t('reminders.label')}
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder={t('reminders.labelHint')} required />
          </label>
          <div className="pet-form-grid">
            <label>
              {t('reminders.everyHours')}
              <input type="text" inputMode="numeric" dir="ltr" pattern="[0-9٠-٩]{1,2}" value={draft.everyHours} onChange={(e) => setDraft({ ...draft, everyHours: e.target.value })} required />
            </label>
            <label>
              {t('reminders.start')}
              <input type="datetime-local" dir="ltr" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} required />
            </label>
            <label>
              {t('reminders.end')}
              <input type="datetime-local" dir="ltr" value={draft.end} min={draft.start} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
            </label>
          </div>
          <div className="record-edit-actions">
            <button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('reminders.save')}
            </button>
            <button type="button" className="cancel-button" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {tasks.length === 0 && !adding && <p className="pet-owner">{t('reminders.none')}</p>}
      <ul className="record-list">
        {tasks.map((task) => {
          const mine = slots.filter((s) => s.task_id === task.id)
          const due = mine.filter((s) => !s.done_at && Date.parse(s.due_at) <= now + 15 * 60_000)
          const done = mine.filter((s) => s.done_at)
          const next = mine.find((s) => Date.parse(s.due_at) > now)
          return (
            <li key={task.id}>
              <div className="record-row">
                <div>
                  <strong>{task.label}</strong>
                  <div className="pet-owner">
                    {t('reminders.schedule', { hours: String(task.every_hours), start: formatDateTime(task.starts_at) })}
                    {task.ends_at && ` · ${t('reminders.until', { end: formatDateTime(task.ends_at) })}`}
                    {next && (
                      <>
                        {' · '}
                        {t('reminders.next')} <Ltr>{formatTime(next.due_at)}</Ltr>
                      </>
                    )}
                  </div>
                  {due.map((slot) => {
                    const overdue = now - Date.parse(slot.due_at) > OVERDUE_AFTER_MS
                    return (
                      <div key={slot.due_at} className="reminder-slot">
                        <span className={overdue ? 'cash-diff-off' : 'data-strong'}>
                          {t(overdue ? 'reminders.overdue' : 'reminders.dueAt', { time: formatTime(slot.due_at) })}
                        </span>
                        {canTick && (
                          <button type="button" className="secondary-button" onClick={() => handleDone(slot)}>
                            {t('reminders.done')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {done.map((slot) => (
                    <div key={slot.due_at} className="reminder-slot pet-owner">
                      <span>
                        {t('reminders.doneLine', { due: formatTime(slot.due_at), name: slot.done_by_name ?? '—', at: formatTime(slot.done_at!) })}
                      </span>
                      {(slot.done_by_name === profile?.full_name || role === 'manager') && (
                        <button type="button" className="cancel-button" onClick={() => handleUndo(slot)}>
                          {t('reminders.undo')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canManage && (
                  <div className="record-actions">
                    <button type="button" className="secondary-button" onClick={() => handleStop(task)}>
                      {t('reminders.stop')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default InpatientReminders
