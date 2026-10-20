import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, dayjsLocalizer } from 'react-big-calendar'
import type { View } from 'react-big-calendar'
import dayjs from 'dayjs'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { visitTypeLabel } from '../lib/visitTypes'
import { STATUS_LABEL_KEYS } from '../lib/appointmentStatus'
import { matchesAppointmentSearch } from '../lib/appointmentSearch'
import { CONFLICT_WINDOW_MS, findAppointmentConflicts } from '../lib/appointmentConflicts'
import type { ConflictCandidate } from '../lib/appointmentConflicts'
import { CANCELLATION_CATEGORIES, cancellationCategoryLabel } from '../lib/cancellation'
import { visitRecordFields } from '../lib/clinicalFields'
import { notifyStatusChange } from '../lib/push'
import { usePrintSummary } from '../lib/PrintContext'
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning'
import PetPicker from '../components/PetPicker'
import MiniMonth from '../components/MiniMonth'
import PhotoThumbnail from '../components/PhotoThumbnail'
import Ltr from '../components/Ltr'
import { useToast } from '../lib/ToastContext'
import LoadingScreen from '../components/LoadingScreen'
import RefreshButton from '../components/RefreshButton'
import RequiredMark from '../components/RequiredMark'

type Appointment = Database['public']['Tables']['appointments']['Row'] & {
  pets: { name: string; owner_phone: string | null } | null
  caregivers: { name: string } | null
}
type Pet = Database['public']['Tables']['pets']['Row']
type Caregiver = Database['public']['Tables']['caregivers']['Row']
type MedicalRecord = Database['public']['Tables']['medical_records']['Row']
// Day view: one event per appointment. Week view: one event per busy hour,
// carrying only the count (appointment is null).
type CalendarEvent = {
  id: string
  title: string
  start: Date
  end: Date
  resourceId: string
  appointment: Appointment | null
  count: number
}
type CalendarResource = { id: string; title: string; subtitle: string | null }

const localizer = dayjsLocalizer(dayjs)
const APPOINTMENT_SELECT = '*, pets(name, owner_phone), caregivers(name)'
const UNASSIGNED = 'unassigned'
// shortcut: appointments have no duration column yet, so every block is 30 min; add appointments.duration_minutes (design doc phase 5).
const SLOT_MS = 30 * 60_000
// shortcut: search scans the latest 500 appointments in the browser; move to a server-side search when a clinic outgrows that.
const SEARCH_POOL_SIZE = 500

type PanelMode = 'details' | 'cancel' | 'reschedule'

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const map = new Map(current.map((row) => [row.id, row]))
  for (const row of incoming) map.set(row.id, row)
  return Array.from(map.values())
}

// The form's 12-hour picker (hour, minute, AM/PM) as a UTC ISO timestamp.
function toScheduledAt(date: string, hour: string, minute: string, period: string) {
  let hour24 = parseInt(hour, 10) % 12
  if (period === 'PM') hour24 += 12
  return new Date(`${date}T${String(hour24).padStart(2, '0')}:${minute}`).toISOString()
}

// A date as the 12-hour picker's fields.
function toPickerFields(date: Date) {
  const hour24 = date.getHours()
  return {
    date: date.toLocaleDateString('en-CA'), // yyyy-mm-dd, matches <input type="date">
    hour: String(hour24 % 12 || 12),
    minute: String(Math.floor(date.getMinutes() / 15) * 15).padStart(2, '0'),
    period: (hour24 >= 12 ? 'PM' : 'AM') as 'AM' | 'PM',
  }
}

// A dedicated query, not the loaded calendar range — that only holds the
// visible day or week and could miss a real conflict just outside it.
async function fetchConflicts(candidate: ConflictCandidate) {
  const time = new Date(candidate.scheduledAt).getTime()
  const { data: nearby } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .neq('status', 'cancelled')
    .gte('scheduled_at', new Date(time - CONFLICT_WINDOW_MS).toISOString())
    .lte('scheduled_at', new Date(time + CONFLICT_WINDOW_MS).toISOString())
  return findAppointmentConflicts(nearby ?? [], candidate)
}

function visibleRange(date: Date, view: View) {
  const unit = view === 'week' ? 'week' : 'day'
  const start = dayjs(date).startOf(unit)
  return { start: start.toDate(), end: start.add(1, unit).toDate() }
}

function AppointmentsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const toast = useToast()
  const navigate = useNavigate()
  const { printSummary } = usePrintSummary()
  const isVet = profile?.role === 'vet'

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [pets, setPets] = useState<Pet[]>([])
  const [staff, setStaff] = useState<Caregiver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [date, setDate] = useState(() => new Date())
  const [view, setView] = useState<View>('day')

  const [search, setSearch] = useState('')
  const [searchPool, setSearchPool] = useState<Appointment[] | null>(null)

  const [selected, setSelected] = useState<Appointment | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode>('details')
  const [record, setRecord] = useState<MedicalRecord | null | undefined>(undefined)
  const [includePhoto, setIncludePhoto] = useState(true)
  const [cancelCategory, setCancelCategory] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleHour, setRescheduleHour] = useState('')
  const [rescheduleMinute, setRescheduleMinute] = useState('')
  const [reschedulePeriod, setReschedulePeriod] = useState<'AM' | 'PM'>('AM')
  const [rescheduleConflicts, setRescheduleConflicts] = useState<Appointment[]>([])
  const [savingPanel, setSavingPanel] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  const [petId, setPetId] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledHour, setScheduledHour] = useState('')
  const [scheduledMinute, setScheduledMinute] = useState('')
  const [scheduledPeriod, setScheduledPeriod] = useState<'AM' | 'PM'>('AM')
  const [reason, setReason] = useState('')
  const [assignedStaffId, setAssignedStaffId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [conflicts, setConflicts] = useState<Appointment[]>([])
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false)
  const scheduleFormRef = useRef<HTMLFormElement>(null)

  useUnsavedChangesWarning(Boolean(petId || scheduledDate || reason) || (selected !== null && panelMode !== 'details'))

  const { start: rangeStart, end: rangeEnd } = visibleRange(date, view)
  const rangeKey = `${rangeStart.getTime()}-${rangeEnd.getTime()}`

  async function loadRange() {
    const { data, error: loadError } = await supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .gte('scheduled_at', rangeStart.toISOString())
      .lt('scheduled_at', rangeEnd.toISOString())
      .order('scheduled_at', { ascending: true })
    if (loadError) setError(loadError.message)
    else setAppointments(data ?? [])
  }

  useEffect(() => {
    Promise.all([
      supabase.from('pets').select('*').is('deleted_at', null).order('name', { ascending: true }),
      supabase.from('caregivers').select('*').is('deleted_at', null).order('name', { ascending: true }),
    ]).then(([petsRes, staffRes]) => {
      setPets(petsRes.data ?? [])
      setStaff(staffRes.data ?? [])
    })
  }, [])

  useEffect(() => {
    loadRange().then(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey])

  async function handleRefresh() {
    setRefreshing(true)
    setSearchPool(null)
    await loadRange()
    setRefreshing(false)
  }

  // Any change makes the cached search results stale.
  function applyUpdate(updated: Appointment) {
    setAppointments((current) => mergeById(current, [updated]))
    setSearchPool(null)
    setSelected(null)
  }

  async function ensureSearchPool() {
    if (searchPool) return
    const { data, error: searchError } = await supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .order('scheduled_at', { ascending: false })
      .limit(SEARCH_POOL_SIZE)
    if (searchError) setError(searchError.message)
    else setSearchPool(data ?? [])
  }

  function openAppointment(appointment: Appointment) {
    setSelected(appointment)
    setPanelMode('details')
    setPanelError(null)
    setCancelCategory('')
    setCancelReason('')
    setRescheduleConflicts([])
    setRecord(undefined)
    setIncludePhoto(true)
    if (appointment.status === 'completed') {
      supabase
        .from('medical_records')
        .select('*')
        .eq('appointment_id', appointment.id)
        .maybeSingle()
        .then(({ data }) => setRecord(data ?? null))
    }
  }

  function jumpTo(appointment: Appointment) {
    setDate(new Date(appointment.scheduled_at))
    setView('day')
    setSearch('')
    openAppointment(appointment)
  }

  function startReschedule(appointment: Appointment) {
    const fields = toPickerFields(new Date(appointment.scheduled_at))
    setRescheduleDate(fields.date)
    setRescheduleHour(fields.hour)
    setRescheduleMinute(fields.minute)
    setReschedulePeriod(fields.period)
    setRescheduleConflicts([])
    setPanelError(null)
    setPanelMode('reschedule')
  }

  async function handleConfirm(appointment: Appointment) {
    const { error: updateError } = await supabase.from('appointments').update({ status: 'confirmed' }).eq('id', appointment.id)
    if (updateError) {
      toast.error(updateError.message)
      return
    }
    applyUpdate({ ...appointment, status: 'confirmed' })
    toast.success(t('appointments.statusUpdated', { status: t(STATUS_LABEL_KEYS.confirmed) }))
    notifyStatusChange(appointment.id)
  }

  async function handleCancel(appointment: Appointment) {
    if (!cancelCategory) {
      setPanelError(t('appointments.chooseCancelReason'))
      return
    }
    setSavingPanel(true)
    const changes = { status: 'cancelled', cancellation_category: cancelCategory, cancellation_reason: cancelReason || null }
    const { error: updateError } = await supabase.from('appointments').update(changes).eq('id', appointment.id)
    setSavingPanel(false)
    if (updateError) {
      setPanelError(updateError.message)
      return
    }
    applyUpdate({ ...appointment, ...changes })
    toast.success(t('appointments.cancelledToast'))
    notifyStatusChange(appointment.id)
  }

  async function handleReschedule(appointment: Appointment, acknowledged = false) {
    if (!rescheduleDate || !rescheduleHour || !rescheduleMinute) {
      setPanelError(t('appointments.chooseDateTime'))
      return
    }
    const newScheduledAt = toScheduledAt(rescheduleDate, rescheduleHour, rescheduleMinute, reschedulePeriod)
    setSavingPanel(true)
    if (!acknowledged) {
      const found = await fetchConflicts({
        petId: appointment.pet_id,
        assignedStaffId: appointment.assigned_staff_id ?? '',
        scheduledAt: newScheduledAt,
        excludeAppointmentId: appointment.id,
      })
      if (found.length > 0) {
        setRescheduleConflicts(found)
        setSavingPanel(false)
        return
      }
    }
    const { error: updateError } = await supabase
      .from('appointments')
      .update({ scheduled_at: newScheduledAt })
      .eq('id', appointment.id)
    setSavingPanel(false)
    if (updateError) {
      setPanelError(updateError.message)
      return
    }
    applyUpdate({ ...appointment, scheduled_at: newScheduledAt })
    toast.success(t('appointments.rescheduledToast'))
    notifyStatusChange(appointment.id)
  }

  useEffect(() => {
    setConflicts([])
    setConflictAcknowledged(false)
  }, [petId, assignedStaffId, scheduledDate, scheduledHour, scheduledMinute, scheduledPeriod])

  async function handleAddAppointment(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!profile || !profile.clinic_id) {
      setError(t('appointments.onlyStaffSchedule'))
      return
    }
    if (!petId) {
      setError(t('appointments.choosePet'))
      return
    }
    if (!assignedStaffId) {
      setError(t('appointments.chooseStaff'))
      return
    }
    if (!scheduledDate || !scheduledHour || !scheduledMinute) {
      setError(t('appointments.chooseDateTime'))
      return
    }

    const scheduledAt = toScheduledAt(scheduledDate, scheduledHour, scheduledMinute, scheduledPeriod)

    if (!conflictAcknowledged) {
      const found = await fetchConflicts({ petId, assignedStaffId, scheduledAt })
      if (found.length > 0) {
        setConflicts(found)
        return
      }
    }

    setSubmitting(true)
    const { data: newAppointment, error: insertError } = await supabase
      .from('appointments')
      .insert({
        pet_id: petId,
        clinic_id: profile.clinic_id,
        scheduled_at: scheduledAt,
        reason: reason || null,
        assigned_staff_id: assignedStaffId || null,
        created_by: profile.id,
      })
      .select(APPOINTMENT_SELECT)
      .single()

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setPetId('')
    setScheduledDate('')
    setScheduledHour('')
    setScheduledMinute('')
    setScheduledPeriod('AM')
    setReason('')
    setAssignedStaffId('')
    setConflicts([])
    setConflictAcknowledged(false)
    setSubmitting(false)
    toast.success(t('appointments.scheduled'))
    setAppointments((current) => mergeById(current, [newAppointment]))
    setSearchPool(null)
    setDate(new Date(newAppointment.scheduled_at))
    notifyStatusChange(newAppointment.id)
  }

  // Clicking an empty slot pre-fills the schedule form with that time and doctor.
  function handleSelectSlot({ start, resourceId }: { start: Date; resourceId?: string | number }) {
    const fields = toPickerFields(start)
    setScheduledDate(fields.date)
    setScheduledHour(fields.hour)
    setScheduledMinute(fields.minute)
    setScheduledPeriod(fields.period)
    if (resourceId && resourceId !== UNASSIGNED) setAssignedStaffId(String(resourceId))
    scheduleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    if (!selected) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !savingPanel) setSelected(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selected, savingPanel])

  const staffIds = useMemo(() => new Set(staff.map((s) => s.id)), [staff])
  const events: CalendarEvent[] = useMemo(() => {
    const visible = appointments.filter((a) => a.status !== 'cancelled')
    if (view === 'week') {
      const byHour = new Map<number, number>()
      for (const a of visible) {
        const hour = dayjs(a.scheduled_at).startOf('hour').valueOf()
        byHour.set(hour, (byHour.get(hour) ?? 0) + 1)
      }
      return Array.from(byHour, ([hour, count]) => ({
        id: `hour-${hour}`,
        title: String(count),
        start: new Date(hour),
        end: new Date(hour + 60 * 60_000),
        resourceId: UNASSIGNED,
        appointment: null,
        count,
      }))
    }
    return visible.map((a) => {
      const start = new Date(a.scheduled_at)
      return {
        id: a.id,
        title: a.pets?.name ?? t('dashboard.unknownPet'),
        start,
        end: new Date(start.getTime() + SLOT_MS),
        // Unassigned also catches appointments whose staff member was removed.
        resourceId: a.assigned_staff_id && staffIds.has(a.assigned_staff_id) ? a.assigned_staff_id : UNASSIGNED,
        appointment: a,
        count: 1,
      }
    })
  }, [appointments, staffIds, t, view])
  const hasUnassigned = view === 'day' && events.some((e) => e.resourceId === UNASSIGNED)
  // Opens at 8 AM, or earlier if the first visible appointment is before that.
  const eightAm = dayjs(date).startOf('day').add(8, 'hour')
  const firstStart = events.reduce<Date | null>((min, e) => (!min || e.start < min ? e.start : min), null)
  const scrollTo = firstStart && dayjs(firstStart).hour() < 8 ? firstStart : eightAm.toDate()
  const resources: CalendarResource[] = [
    ...staff.map((s) => ({ id: s.id, title: s.name, subtitle: s.title })),
    ...(hasUnassigned || staff.length === 0 ? [{ id: UNASSIGNED, title: t('calendar.unassigned'), subtitle: null }] : []),
  ]

  const query = search.trim()
  const searchResults = query && searchPool ? searchPool.filter((a) => matchesAppointmentSearch(a, query)).slice(0, 8) : []

  if (loading) return <LoadingScreen />

  function renderPanel(appointment: Appointment) {
    const isActive = appointment.status === 'requested' || appointment.status === 'confirmed'
    return (
      <div className="admin-modal-backdrop" onClick={() => !savingPanel && setSelected(null)}>
        <div
          className="admin-modal-card appointment-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="appointment-panel-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="appointment-panel-header">
            <div>
              <h2 id="appointment-panel-title">{appointment.pets?.name ?? t('dashboard.unknownPet')}</h2>
              <p className="pet-owner">
                <Ltr>{new Date(appointment.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Ltr>
                {appointment.caregivers && ` · ${appointment.caregivers.name}`}
              </p>
              {appointment.reason && (
                <p className="pet-owner">
                  {t('appointments.reasonLabel')}: {appointment.reason}
                </p>
              )}
              {appointment.status === 'cancelled' && (appointment.cancellation_category || appointment.cancellation_reason) && (
                <p className="pet-owner">
                  {t('appointments.cancelledLabel')}:{' '}
                  {appointment.cancellation_category ? cancellationCategoryLabel(t, appointment.cancellation_category) : ''}
                  {appointment.cancellation_category && appointment.cancellation_reason ? ' — ' : ''}
                  {appointment.cancellation_reason ?? ''}
                </p>
              )}
            </div>
            <span className={`status-badge status-${appointment.status}`}>{t(STATUS_LABEL_KEYS[appointment.status])}</span>
          </div>

          {panelError && <p className="form-error">{panelError}</p>}

          {panelMode === 'cancel' ? (
            <>
              <label>
                {t('appointments.cancelReasonLabel')}
                <RequiredMark />
                <select value={cancelCategory} onChange={(e) => setCancelCategory(e.target.value)} required autoFocus>
                  <option value="" disabled>
                    {t('appointments.selectCancelReason')}
                  </option>
                  {CANCELLATION_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {cancellationCategoryLabel(t, category)}
                    </option>
                  ))}
                </select>
              </label>
              {cancelCategory === 'other' && (
                <label>
                  {t('appointments.cancelReasonDetail')}
                  <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} />
                </label>
              )}
              <div className="record-edit-actions">
                <button type="button" className="delete-button" onClick={() => handleCancel(appointment)} disabled={savingPanel}>
                  {savingPanel ? t('common.saving') : t('appointments.confirmCancellation')}
                </button>
                <button type="button" className="cancel-button" onClick={() => setPanelMode('details')} disabled={savingPanel}>
                  {t('appointments.confirmBack')}
                </button>
              </div>
            </>
          ) : panelMode === 'reschedule' ? (
            <>
              <label>
                {t('appointments.date')}
                <RequiredMark />
                <input
                  type="date"
                  dir="ltr"
                  value={rescheduleDate}
                  onChange={(e) => {
                    setRescheduleDate(e.target.value)
                    setRescheduleConflicts([])
                  }}
                  required
                />
              </label>
              <label>
                {t('appointments.time')}
                <RequiredMark />
                <div className="time-select" dir="ltr">
                  <select
                    value={rescheduleHour}
                    onChange={(e) => {
                      setRescheduleHour(e.target.value)
                      setRescheduleConflicts([])
                    }}
                    required
                  >
                    <option value="" disabled>
                      {t('appointments.hour')}
                    </option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span>:</span>
                  <select
                    value={rescheduleMinute}
                    onChange={(e) => {
                      setRescheduleMinute(e.target.value)
                      setRescheduleConflicts([])
                    }}
                    required
                  >
                    <option value="" disabled>
                      {t('appointments.min')}
                    </option>
                    {['00', '15', '30', '45'].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    value={reschedulePeriod}
                    onChange={(e) => {
                      setReschedulePeriod(e.target.value as 'AM' | 'PM')
                      setRescheduleConflicts([])
                    }}
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </label>
              {rescheduleConflicts.length > 0 && (
                <div className="form-warning">
                  <p>{t('appointments.conflictWarning', { count: String(rescheduleConflicts.length) })}</p>
                  <ul>
                    {rescheduleConflicts.map((c) => (
                      <li key={c.id}>
                        {c.pets?.name ?? t('dashboard.unknownPet')} — <Ltr>{new Date(c.scheduled_at).toLocaleString()}</Ltr>
                        {c.caregivers?.name ? ` (${c.caregivers.name})` : ''}
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="secondary-button" onClick={() => handleReschedule(appointment, true)}>
                    {t('appointments.scheduleAnyway')}
                  </button>
                </div>
              )}
              <div className="record-edit-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => handleReschedule(appointment)}
                  disabled={savingPanel}
                >
                  {savingPanel ? t('common.saving') : t('appointments.confirmReschedule')}
                </button>
                <button type="button" className="cancel-button" onClick={() => setPanelMode('details')} disabled={savingPanel}>
                  {t('appointments.confirmBack')}
                </button>
              </div>
            </>
          ) : (
            <>
              {appointment.status === 'completed' &&
                (record === undefined ? (
                  <p className="pet-owner">{t('common.loading')}</p>
                ) : record ? (
                  <div className="appointment-panel-record">
                    <p className="pending-action-title">{t('appointments.visitDetailsTitle')}</p>
                    {record.visit_type && (
                      <p className="pet-owner">
                        {t('petDetail.visitType')}: {visitTypeLabel(t, record.visit_type)}
                      </p>
                    )}
                    {visitRecordFields(record).map((field) => (
                      <p key={field.labelKey} className="pet-owner">
                        {t(field.labelKey)}: {field.value}
                      </p>
                    ))}
                    {record.photo_url && (
                      <div className="record-photo">
                        <PhotoThumbnail path={record.photo_url} alt={t('petDetail.recordPhotoAlt')} size={56} />
                      </div>
                    )}
                    <div className="record-actions">
                      {record.photo_url && (
                        <label className="include-photo-toggle">
                          <input type="checkbox" checked={includePhoto} onChange={(e) => setIncludePhoto(e.target.checked)} />
                          {t('petDetail.includePhoto')}
                        </label>
                      )}
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          printSummary(appointment.pets?.name ?? t('dashboard.unknownPet'), {
                            date: record.visit_date,
                            visitType: record.visit_type ? visitTypeLabel(t, record.visit_type) : undefined,
                            record,
                            photoUrl: includePhoto ? record.photo_url : null,
                          })
                        }
                      >
                        {t('common.print')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="pet-owner">{t('appointments.noRecord')}</p>
                ))}

              <div className="appointment-panel-actions">
                {isVet && isActive && (
                  <>
                    {appointment.status === 'requested' && (
                      <button type="button" className="secondary-button" onClick={() => handleConfirm(appointment)} autoFocus>
                        {t('appointments.confirmAppointment')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => navigate(`/appointments/${appointment.id}/session`)}
                    >
                      {t('session.start')}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => startReschedule(appointment)}>
                      {t('appointments.reschedule')}
                    </button>
                    <button type="button" className="delete-button" onClick={() => setPanelMode('cancel')}>
                      {t('appointments.cancel')}
                    </button>
                  </>
                )}
                <button type="button" className="cancel-button" onClick={() => setSelected(null)}>
                  {t('common.close')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('appointments.title')}</h1>
        <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="appointment-search">
        <input
          type="search"
          className="search-input"
          placeholder={t('appointments.searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            if (e.target.value.trim()) ensureSearchPool()
          }}
        />
        {query && searchPool && (
          <ul className="appointment-search-results">
            {searchResults.length === 0 ? (
              <li className="pet-owner">{t('appointments.searchNoMatch', { query })}</li>
            ) : (
              searchResults.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => jumpTo(a)}>
                    <strong>{a.pets?.name ?? t('dashboard.unknownPet')}</strong>
                    <Ltr>{new Date(a.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Ltr>
                    {a.caregivers && <span>{a.caregivers.name}</span>}
                    <span className={`status-badge status-${a.status}`}>{t(STATUS_LABEL_KEYS[a.status])}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Fixed left-to-right in both languages so time stays on the left. */}
      {/* LTR so the month picker stays on the left in both languages, like the calendar. */}
      <div className="appointments-layout" dir="ltr">
      <MiniMonth value={date} onChange={setDate} />
      {/* --now-cols centres the "Now" pill across all doctor columns (see App.css). */}
      <div
        className="appointments-calendar"
        dir="ltr"
        style={
          {
            '--now-label': JSON.stringify(t('calendar.now')),
            '--now-cols': view === 'day' ? resources.length : 1,
          } as CSSProperties
        }
      >
        <Calendar<CalendarEvent, CalendarResource>
          localizer={localizer}
          events={events}
          date={date}
          view={view}
          views={['day', 'week']}
          onNavigate={setDate}
          onView={setView}
          resources={view === 'day' ? resources : undefined}
          resourceIdAccessor="id"
          resourceTitleAccessor="title"
          step={15}
          dayLayoutAlgorithm="no-overlap"
          timeslots={4}
          scrollToTime={scrollTo}
          selectable={isVet}
          onSelectSlot={handleSelectSlot}
          onSelectEvent={(event) => {
            if (event.appointment) return openAppointment(event.appointment)
            // A week-view hour box opens that day with the individual appointments.
            setDate(event.start)
            setView('day')
          }}
          eventPropGetter={(event) => ({
            className: event.appointment ? `calendar-event status-${event.appointment.status}` : 'calendar-hour-count',
          })}
          components={{
            event: ({ event }) =>
              event.appointment ? (
                <span className="calendar-event-content">
                  <strong>{event.title}</strong>
                  {event.appointment.reason && <span>{event.appointment.reason}</span>}
                </span>
              ) : (
                <span className="calendar-hour-count-content">
                  <strong>{event.count}</strong>
                  <span>{t(event.count === 1 ? 'calendar.appointmentOne' : 'calendar.appointmentMany')}</span>
                </span>
              ),
            resourceHeader: ({ resource }) => (
              <span className="calendar-resource-header">
                <strong>{resource.title}</strong>
                {resource.subtitle && <span>{resource.subtitle}</span>}
              </span>
            ),
          }}
          messages={{
            today: t('calendar.today'),
            previous: t('calendar.back'),
            next: t('calendar.next'),
            day: t('calendar.day'),
            week: t('calendar.week'),
          }}
        />
      </div>
      </div>

      {selected && renderPanel(selected)}

      {isVet && (
        <form ref={scheduleFormRef} onSubmit={handleAddAppointment} className="pet-form pet-form-grid">
          <h2>{t('appointments.schedule')}</h2>
          <p className="pet-owner appointment-schedule-hint">{t('calendar.slotHint')}</p>
          <label>
            {t('appointments.pet')}
            <RequiredMark />
            <PetPicker pets={pets} value={petId} onChange={setPetId} />
          </label>
          <label>
            {t('appointments.date')}
            <RequiredMark />
            <input type="date" dir="ltr" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} required />
          </label>
          <label>
            {t('appointments.time')}
            <RequiredMark />
            <div className="time-select" dir="ltr">
              <select value={scheduledHour} onChange={(e) => setScheduledHour(e.target.value)} required>
                <option value="" disabled>
                  {t('appointments.hour')}
                </option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span>:</span>
              <select value={scheduledMinute} onChange={(e) => setScheduledMinute(e.target.value)} required>
                <option value="" disabled>
                  {t('appointments.min')}
                </option>
                {['00', '15', '30', '45'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select value={scheduledPeriod} onChange={(e) => setScheduledPeriod(e.target.value as 'AM' | 'PM')}>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </label>
          <label>
            {t('appointments.reason')}
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label>
            {t('appointments.staffHandling')}
            <RequiredMark />
            <select value={assignedStaffId} onChange={(e) => setAssignedStaffId(e.target.value)} required>
              <option value="" disabled>
                {t('appointments.selectStaffMember')}
              </option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.title ? ` — ${member.title}` : ''}
                </option>
              ))}
            </select>
          </label>
          {conflicts.length > 0 && (
            <div className="form-warning">
              <p>{t('appointments.conflictWarning', { count: String(conflicts.length) })}</p>
              <ul>
                {conflicts.map((c) => (
                  <li key={c.id}>
                    {c.pets?.name ?? t('dashboard.unknownPet')} — <Ltr>{new Date(c.scheduled_at).toLocaleString()}</Ltr>
                    {c.caregivers?.name ? ` (${c.caregivers.name})` : ''}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setConflictAcknowledged(true)
                  requestAnimationFrame(() => scheduleFormRef.current?.requestSubmit())
                }}
              >
                {t('appointments.scheduleAnyway')}
              </button>
            </div>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? t('common.saving') : t('appointments.scheduleSubmit')}
          </button>
        </form>
      )}
    </div>
  )
}

export default AppointmentsPage
