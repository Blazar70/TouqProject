import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { VISIT_TYPES, visitTypeLabel } from '../lib/visitTypes'
import { STATUS_LABEL_KEYS } from '../lib/appointmentStatus'
import { matchesAppointmentSearch } from '../lib/appointmentSearch'
import { findAppointmentConflicts } from '../lib/appointmentConflicts'
import { CANCELLATION_CATEGORIES, cancellationCategoryLabel } from '../lib/cancellation'
import { validateImageFile } from '../lib/imageUpload'
import { usePasteImage } from '../lib/usePasteImage'
import { useDropImage } from '../lib/useDropImage'
import { usePrintSummary } from '../lib/PrintContext'
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning'
import PetPicker from '../components/PetPicker'
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

const ARCHIVED_STATUSES = new Set(['completed', 'cancelled'])

type PendingAction = { appointmentId: string; kind: 'cancel' | 'complete' | 'reschedule' }

const PAST_PAGE_SIZE = 10
const ACTIVE_STATUSES = ['requested', 'confirmed']
const APPOINTMENT_SELECT = '*, pets(name, owner_phone), caregivers(name)'

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const map = new Map(current.map((row) => [row.id, row]))
  for (const row of incoming) map.set(row.id, row)
  return Array.from(map.values())
}

// Midnight today through `days` days out — the active list loads one day
// at a time rather than every future appointment ever scheduled.
function activeWindow(days: number) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + days)
  return { start, end }
}

function AppointmentsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const toast = useToast()
  const { printSummary } = usePrintSummary()
  const isVet = profile?.role === 'vet'

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [pets, setPets] = useState<Pet[]>([])
  const [staff, setStaff] = useState<Caregiver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const [search, setSearch] = useState('')
  const [activeDays, setActiveDays] = useState(1)
  const [hasMoreActive, setHasMoreActive] = useState(false)
  const [loadingMoreActive, setLoadingMoreActive] = useState(false)
  const [pastLimit, setPastLimit] = useState(PAST_PAGE_SIZE)
  const [pastTotal, setPastTotal] = useState(0)
  const [hasMorePast, setHasMorePast] = useState(false)
  const [loadingMorePast, setLoadingMorePast] = useState(false)
  const [expandedAppointmentId, setExpandedAppointmentId] = useState<string | null>(null)
  const [recordsByAppointment, setRecordsByAppointment] = useState<Record<string, MedicalRecord | null>>({})
  const [loadingRecordId, setLoadingRecordId] = useState<string | null>(null)
  const [includePhotoByRecord, setIncludePhotoByRecord] = useState<Record<string, boolean>>({})

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

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [cancelCategory, setCancelCategory] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [completionVisitType, setCompletionVisitType] = useState('')
  const [completionDiagnosis, setCompletionDiagnosis] = useState('')
  const [completionTreatment, setCompletionTreatment] = useState('')
  const [completionNotes, setCompletionNotes] = useState('')
  const [completionPhotoFile, setCompletionPhotoFile] = useState<File | null>(null)
  const [completionPhotoPreviewUrl, setCompletionPhotoPreviewUrl] = useState<string | null>(null)
  const [savingPending, setSavingPending] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleHour, setRescheduleHour] = useState('')
  const [rescheduleMinute, setRescheduleMinute] = useState('')
  const [reschedulePeriod, setReschedulePeriod] = useState<'AM' | 'PM'>('AM')
  const [rescheduleConflicts, setRescheduleConflicts] = useState<Appointment[]>([])
  const [rescheduleConflictAcknowledged, setRescheduleConflictAcknowledged] = useState(false)

  // Also guards the inline cancel/complete/reschedule panels above — opening
  // one is a deliberate, stateful action, so leaving it open while
  // navigating away is worth a confirm just like an unsaved form field.
  useUnsavedChangesWarning(Boolean(petId || scheduledDate || reason) || pendingAction !== null)

  // Rows that just changed status/time get a brief highlight so the change
  // is easy to spot in a list that can otherwise silently re-sort under you.
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState<Set<string>>(new Set())
  function flashUpdated(id: string) {
    setRecentlyUpdatedIds((current) => new Set(current).add(id))
    setTimeout(() => {
      setRecentlyUpdatedIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }, 2000)
  }

  async function loadActive(days: number) {
    const { start, end } = activeWindow(days)
    const { data, error: activeError } = await supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .in('status', ACTIVE_STATUSES)
      .gte('scheduled_at', start.toISOString())
      .lt('scheduled_at', end.toISOString())
      .order('scheduled_at', { ascending: true })
    if (activeError) {
      setError(activeError.message)
      return
    }
    setAppointments((current) => mergeById(current, data ?? []))

    // Only checks the immediate next day, not "anything further in the
    // future" — so the button reflects whether clicking it will actually
    // surface something, rather than staying lit for days on an appointment
    // that's still a week out.
    const nextDayEnd = new Date(end)
    nextDayEnd.setDate(nextDayEnd.getDate() + 1)
    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .in('status', ACTIVE_STATUSES)
      .gte('scheduled_at', end.toISOString())
      .lt('scheduled_at', nextDayEnd.toISOString())
    setHasMoreActive((count ?? 0) > 0)
  }

  async function loadPast(limit: number) {
    const { data, error: pastError } = await supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .in('status', Array.from(ARCHIVED_STATUSES))
      .order('scheduled_at', { ascending: false })
      .range(0, limit - 1)
    if (pastError) {
      setError(pastError.message)
      return
    }
    setAppointments((current) => mergeById(current, data ?? []))

    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .in('status', Array.from(ARCHIVED_STATUSES))
    setPastTotal(count ?? 0)
    setHasMorePast((count ?? 0) > limit)
  }

  async function loadData() {
    setLoading(true)
    const [petsRes, staffRes] = await Promise.all([
      supabase.from('pets').select('*').is('deleted_at', null).order('name', { ascending: true }),
      supabase.from('caregivers').select('*').is('deleted_at', null).order('name', { ascending: true }),
      loadActive(activeDays),
      loadPast(pastLimit),
    ])
    setPets(petsRes.data ?? [])
    setStaff(staffRes.data ?? [])
    setLoading(false)
  }

  // Re-fetches at whatever pagination depth is currently loaded, without the
  // full-page LoadingScreen — for catching up on changes another staff
  // member made while this tab sat open.
  const [refreshing, setRefreshing] = useState(false)
  async function handleRefresh() {
    setRefreshing(true)
    await Promise.all([loadActive(activeDays), loadPast(pastLimit)])
    setRefreshing(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleLoadMoreActive() {
    setLoadingMoreActive(true)
    const nextDays = activeDays + 1
    await loadActive(nextDays)
    setActiveDays(nextDays)
    setLoadingMoreActive(false)
  }

  async function handleLoadMorePast() {
    setLoadingMorePast(true)
    const nextLimit = pastLimit + PAST_PAGE_SIZE
    await loadPast(nextLimit)
    setPastLimit(nextLimit)
    setLoadingMorePast(false)
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

    let hour24 = parseInt(scheduledHour, 10) % 12
    if (scheduledPeriod === 'PM') hour24 += 12
    const time24 = `${String(hour24).padStart(2, '0')}:${scheduledMinute}`
    const scheduledAt = new Date(`${scheduledDate}T${time24}`).toISOString()

    if (!conflictAcknowledged) {
      // A dedicated query, not the loaded `appointments` state — that only
      // holds the currently-paginated window, which could easily miss a
      // real conflict sitting outside it (e.g. days ahead of what's loaded).
      const candidateTime = new Date(scheduledAt).getTime()
      const windowStart = new Date(candidateTime - 30 * 60_000).toISOString()
      const windowEnd = new Date(candidateTime + 30 * 60_000).toISOString()
      const { data: nearby } = await supabase
        .from('appointments')
        .select(APPOINTMENT_SELECT)
        .neq('status', 'cancelled')
        .gte('scheduled_at', windowStart)
        .lte('scheduled_at', windowEnd)
      const found = findAppointmentConflicts(nearby ?? [], { petId, assignedStaffId, scheduledAt })
      if (found.length > 0) {
        setConflicts(found)
        return
      }
    }

    setSubmitting(true)
    const { data: newAppointment, error } = await supabase
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

    if (error) {
      setError(error.message)
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
    // Merged in directly rather than re-querying the active window — the
    // appointment the user just created should show up immediately even if
    // it falls outside however many days are currently paginated in.
    setAppointments((current) => mergeById(current, [newAppointment]))
    notifyStatusChange(newAppointment.id)
  }

  function clearCompletionPhoto() {
    setCompletionPhotoFile(null)
    setCompletionPhotoPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url)
      return null
    })
  }

  const processCompletionPhotoFile = useCallback(
    (file: File) => {
      const validationError = validateImageFile(file)
      if (validationError) {
        setError(validationError === 'notImage' ? t('petDetail.imageOnly') : t('petDetail.imageTooLarge'))
        return
      }

      setError(null)
      setCompletionPhotoPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return URL.createObjectURL(file)
      })
      setCompletionPhotoFile(file)
    },
    [t],
  )

  function handleCompletionPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) processCompletionPhotoFile(file)
  }

  // Pasting a screenshot/copied image (Ctrl+V) works the same as picking a
  // file — only while the completion form is actually open.
  usePasteImage(processCompletionPhotoFile, pendingAction?.kind === 'complete')
  const { dragActive: completionPhotoDragActive, dragHandlers: completionPhotoDragHandlers } = useDropImage(
    processCompletionPhotoFile,
    pendingAction?.kind === 'complete',
  )

  function resetPendingFields() {
    setCancelCategory('')
    setCancelReason('')
    setCompletionVisitType('')
    setCompletionDiagnosis('')
    setCompletionTreatment('')
    setCompletionNotes('')
    clearCompletionPhoto()
    setRescheduleDate('')
    setRescheduleHour('')
    setRescheduleMinute('')
    setReschedulePeriod('AM')
    setRescheduleConflicts([])
    setRescheduleConflictAcknowledged(false)
  }

  function startReschedule(appointment: Appointment) {
    const current = new Date(appointment.scheduled_at)
    const hour24 = current.getHours()
    setRescheduleDate(current.toLocaleDateString('en-CA')) // yyyy-mm-dd, matches <input type="date">
    setRescheduleHour(String(hour24 % 12 || 12))
    setRescheduleMinute(String(current.getMinutes()).padStart(2, '0'))
    setReschedulePeriod(hour24 >= 12 ? 'PM' : 'AM')
    setRescheduleConflicts([])
    setRescheduleConflictAcknowledged(false)
    setPendingAction({ appointmentId: appointment.id, kind: 'reschedule' })
    setCancelCategory('')
    setCancelReason('')
    setCompletionVisitType('')
    setCompletionDiagnosis('')
    setCompletionTreatment('')
    setCompletionNotes('')
    clearCompletionPhoto()
  }

  async function handleStatusChange(appointment: Appointment, status: string) {
    if (status === 'completed' || status === 'cancelled') {
      setPendingAction({ appointmentId: appointment.id, kind: status === 'completed' ? 'complete' : 'cancel' })
      resetPendingFields()
      return
    }

    const { error } = await supabase.from('appointments').update({ status }).eq('id', appointment.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setAppointments((current) => current.map((a) => (a.id === appointment.id ? { ...a, status } : a)))
    toast.success(t('appointments.statusUpdated', { status: t(STATUS_LABEL_KEYS[status]) }))
    flashUpdated(appointment.id)
    notifyStatusChange(appointment.id)
  }

  // Best-effort — a failed push notification shouldn't surface as an error
  // to the person who just successfully updated the appointment.
  function notifyStatusChange(appointmentId: string) {
    supabase.functions.invoke('notify-status-change', { body: { appointmentId } }).catch(() => {})
  }

  function startCancel(appointment: Appointment) {
    setPendingAction({ appointmentId: appointment.id, kind: 'cancel' })
    resetPendingFields()
  }

  async function toggleDetails(appointment: Appointment) {
    if (expandedAppointmentId === appointment.id) {
      setExpandedAppointmentId(null)
      return
    }
    setExpandedAppointmentId(appointment.id)
    if (appointment.status !== 'completed' || appointment.id in recordsByAppointment) return

    setLoadingRecordId(appointment.id)
    const { data } = await supabase
      .from('medical_records')
      .select('*')
      .eq('appointment_id', appointment.id)
      .maybeSingle()
    setRecordsByAppointment((current) => ({ ...current, [appointment.id]: data ?? null }))
    setLoadingRecordId(null)
  }

  async function confirmPendingAction(forceRescheduleAcknowledged = false) {
    if (!pendingAction) return
    const appointment = appointments.find((a) => a.id === pendingAction.appointmentId)
    if (!appointment) return

    setSavingPending(true)
    setError(null)

    if (pendingAction.kind === 'cancel') {
      if (!cancelCategory) {
        setError(t('appointments.chooseCancelReason'))
        setSavingPending(false)
        return
      }

      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'cancelled',
          cancellation_category: cancelCategory,
          cancellation_reason: cancelReason || null,
        })
        .eq('id', appointment.id)

      if (error) {
        setError(error.message)
        setSavingPending(false)
        return
      }
      setAppointments((current) =>
        current.map((a) =>
          a.id === appointment.id
            ? { ...a, status: 'cancelled', cancellation_category: cancelCategory, cancellation_reason: cancelReason || null }
            : a,
        ),
      )
      toast.success(t('appointments.cancelledToast'))
      flashUpdated(appointment.id)
      notifyStatusChange(appointment.id)
    } else if (pendingAction.kind === 'reschedule') {
      if (!rescheduleDate || !rescheduleHour || !rescheduleMinute) {
        setError(t('appointments.chooseDateTime'))
        setSavingPending(false)
        return
      }

      let hour24 = parseInt(rescheduleHour, 10) % 12
      if (reschedulePeriod === 'PM') hour24 += 12
      const time24 = `${String(hour24).padStart(2, '0')}:${rescheduleMinute}`
      const newScheduledAt = new Date(`${rescheduleDate}T${time24}`).toISOString()

      if (!rescheduleConflictAcknowledged && !forceRescheduleAcknowledged) {
        const candidateTime = new Date(newScheduledAt).getTime()
        const windowStart = new Date(candidateTime - 30 * 60_000).toISOString()
        const windowEnd = new Date(candidateTime + 30 * 60_000).toISOString()
        const { data: nearby } = await supabase
          .from('appointments')
          .select(APPOINTMENT_SELECT)
          .neq('status', 'cancelled')
          .gte('scheduled_at', windowStart)
          .lte('scheduled_at', windowEnd)
        const found = findAppointmentConflicts(nearby ?? [], {
          petId: appointment.pet_id,
          assignedStaffId: appointment.assigned_staff_id ?? '',
          scheduledAt: newScheduledAt,
          excludeAppointmentId: appointment.id,
        })
        if (found.length > 0) {
          setRescheduleConflicts(found)
          setSavingPending(false)
          return
        }
      }

      const { error } = await supabase
        .from('appointments')
        .update({ scheduled_at: newScheduledAt })
        .eq('id', appointment.id)

      if (error) {
        setError(error.message)
        setSavingPending(false)
        return
      }
      setAppointments((current) =>
        current.map((a) => (a.id === appointment.id ? { ...a, scheduled_at: newScheduledAt } : a)),
      )
      toast.success(t('appointments.rescheduledToast'))
      flashUpdated(appointment.id)
      notifyStatusChange(appointment.id)
    } else {
      if (!profile?.clinic_id) {
        setError(t('appointments.onlyStaffComplete'))
        setSavingPending(false)
        return
      }
      if (!completionVisitType || !completionDiagnosis || !completionTreatment) {
        setError(t('appointments.completionRequired'))
        setSavingPending(false)
        return
      }

      const { error: appointmentError } = await supabase
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', appointment.id)

      if (appointmentError) {
        setError(appointmentError.message)
        setSavingPending(false)
        return
      }

      const { data: newRecord, error: recordError } = await supabase
        .from('medical_records')
        .insert({
          pet_id: appointment.pet_id,
          clinic_id: profile.clinic_id,
          vet_id: profile.id,
          appointment_id: appointment.id,
          visit_type: completionVisitType,
          diagnosis: completionDiagnosis,
          treatment: completionTreatment,
          notes: completionNotes || null,
        })
        .select()
        .single()
      if (recordError || !newRecord) {
        setError(t('appointments.recordFailed', { error: recordError?.message ?? '' }))
        setSavingPending(false)
        return
      }

      // The record's already saved at this point — a photo upload failure
      // is worth surfacing but shouldn't undo the completion.
      if (completionPhotoFile) {
        const ext = completionPhotoFile.name.split('.').pop() || 'jpg'
        const path = `${profile.clinic_id}/records/${newRecord.id}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('pet-photos')
          .upload(path, completionPhotoFile, { upsert: true, contentType: completionPhotoFile.type })
        if (uploadError) {
          toast.error(t('common.couldNotSavePhoto'))
        } else {
          const { data: publicUrlData } = supabase.storage.from('pet-photos').getPublicUrl(path)
          await supabase.from('medical_records').update({ photo_url: publicUrlData.publicUrl }).eq('id', newRecord.id)
        }
      }

      setAppointments((current) => current.map((a) => (a.id === appointment.id ? { ...a, status: 'completed' } : a)))
      toast.success(t('appointments.completedToast'))
      flashUpdated(appointment.id)
      notifyStatusChange(appointment.id)
    }

    setPendingAction(null)
    resetPendingFields()
    setSavingPending(false)
  }

  function renderAppointment(appointment: Appointment) {
    const isFinal = ARCHIVED_STATUSES.has(appointment.status)
    const isPending = pendingAction?.appointmentId === appointment.id

    const justUpdated = recentlyUpdatedIds.has(appointment.id)

    return (
      <li key={appointment.id} className={`pet-list-item${justUpdated ? ' just-updated' : ''}`}>
        <div className="pet-row">
          <div>
            <strong>{appointment.pets?.name ?? t('dashboard.unknownPet')}</strong>
            {' — '}
            <Ltr>{new Date(appointment.scheduled_at).toLocaleString()}</Ltr>
            {appointment.reason && (
              <div className="pet-owner">
                {t('appointments.reasonLabel')}: {appointment.reason}
              </div>
            )}
            {appointment.caregivers && (
              <div className="pet-owner">
                {t('appointments.staffLabel')}: {appointment.caregivers.name}
              </div>
            )}
            {appointment.status === 'cancelled' && (appointment.cancellation_category || appointment.cancellation_reason) && (
              <div className="pet-owner">
                {t('appointments.cancelledLabel')}:{' '}
                {appointment.cancellation_category ? cancellationCategoryLabel(t, appointment.cancellation_category) : ''}
                {appointment.cancellation_category && appointment.cancellation_reason ? ' — ' : ''}
                {appointment.cancellation_reason ?? ''}
              </div>
            )}
          </div>
          {isVet && !isFinal ? (
            <div className="record-actions">
              <span className={`status-badge status-${appointment.status}`}>
                {t(STATUS_LABEL_KEYS[appointment.status])}
              </span>
              {appointment.status === 'requested' && (
                <button type="button" className="secondary-button" onClick={() => handleStatusChange(appointment, 'confirmed')}>
                  {t('appointments.confirmAppointment')}
                </button>
              )}
              {(appointment.status === 'confirmed' || appointment.status === 'requested') && (
                <button type="button" className="secondary-button" onClick={() => handleStatusChange(appointment, 'completed')}>
                  {t('appointments.markCompleted')}
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => startReschedule(appointment)}>
                {t('appointments.reschedule')}
              </button>
              <button type="button" className="delete-button" onClick={() => startCancel(appointment)}>
                {t('appointments.cancel')}
              </button>
            </div>
          ) : appointment.status === 'completed' ? (
            <div className="record-actions">
              <span className={`status-badge status-${appointment.status}`}>
                {t(STATUS_LABEL_KEYS[appointment.status])}
              </span>
              <button type="button" className="secondary-button" onClick={() => toggleDetails(appointment)}>
                {expandedAppointmentId === appointment.id ? t('appointments.hideDetails') : t('appointments.viewDetails')}
              </button>
            </div>
          ) : (
            <span className={`status-badge status-${appointment.status}`}>{t(STATUS_LABEL_KEYS[appointment.status])}</span>
          )}
        </div>

        {expandedAppointmentId === appointment.id &&
          appointment.status === 'completed' &&
          (() => {
            const record = recordsByAppointment[appointment.id]
            return (
              <div className="pending-action">
                {loadingRecordId === appointment.id ? (
                  <p className="pet-owner">{t('common.loading')}</p>
                ) : record ? (
                  <>
                    <p className="pending-action-title">{t('appointments.visitDetailsTitle')}</p>
                    {record.visit_type && (
                      <p className="pet-owner">
                        {t('petDetail.visitType')}: {visitTypeLabel(t, record.visit_type)}
                      </p>
                    )}
                    <p className="pet-owner">
                      {t('petDetail.diagnosis')}: {record.diagnosis}
                    </p>
                    <p className="pet-owner">
                      {t('petDetail.treatment')}: {record.treatment}
                    </p>
                    {record.notes && (
                      <p className="pet-owner">
                        {t('appointments.notesOptional')}: {record.notes}
                      </p>
                    )}
                    {record.photo_url && (
                      <div className="record-photo">
                        <PhotoThumbnail url={record.photo_url} alt={t('petDetail.recordPhotoAlt')} size={56} />
                      </div>
                    )}
                    <div className="record-actions">
                      {record.photo_url && (
                        <label className="include-photo-toggle">
                          <input
                            type="checkbox"
                            checked={includePhotoByRecord[record.id] ?? true}
                            onChange={(e) =>
                              setIncludePhotoByRecord((current) => ({ ...current, [record.id]: e.target.checked }))
                            }
                          />
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
                            diagnosis: record.diagnosis ?? '',
                            treatment: record.treatment ?? '',
                            notes: record.notes,
                            photoUrl: (includePhotoByRecord[record.id] ?? true) ? record.photo_url : null,
                          })
                        }
                      >
                        {t('common.print')}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="pet-owner">{t('appointments.noRecord')}</p>
                )}
              </div>
            )
          })()}

        {isPending && pendingAction && (
          <div className="pending-action">
            {pendingAction.kind === 'cancel' ? (
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
              </>
            ) : pendingAction.kind === 'reschedule' ? (
              <>
                <p className="pending-action-title">{t('appointments.reschedule')}</p>
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
                      setRescheduleConflictAcknowledged(false)
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
                        setRescheduleConflictAcknowledged(false)
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
                        setRescheduleConflictAcknowledged(false)
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
                        setRescheduleConflictAcknowledged(false)
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
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setRescheduleConflictAcknowledged(true)
                        confirmPendingAction(true)
                      }}
                    >
                      {t('appointments.scheduleAnyway')}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="pending-action-title">{t('appointments.visitDetailsTitle')}</p>
                <label>
                  {t('petDetail.visitType')}
                  <RequiredMark />
                  <select value={completionVisitType} onChange={(e) => setCompletionVisitType(e.target.value)} required>
                    <option value="" disabled>
                      {t('appointments.selectVisitType')}
                    </option>
                    {VISIT_TYPES.map((vt) => (
                      <option key={vt} value={vt}>
                        {visitTypeLabel(t, vt)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('petDetail.diagnosis')}
                  <RequiredMark />
                  <input value={completionDiagnosis} onChange={(e) => setCompletionDiagnosis(e.target.value)} required />
                </label>
                <label>
                  {t('petDetail.treatment')}
                  <RequiredMark />
                  <input value={completionTreatment} onChange={(e) => setCompletionTreatment(e.target.value)} required />
                </label>
                <label>
                  {t('appointments.notesOptional')}
                  <textarea value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} rows={2} />
                </label>
                <div
                  className={`pet-photo-row${completionPhotoDragActive ? ' pet-photo-row-drag-active' : ''}`}
                  {...completionPhotoDragHandlers}
                >
                  {completionPhotoPreviewUrl && (
                    <img src={completionPhotoPreviewUrl} alt="" className="pet-avatar" style={{ width: 56, height: 56 }} />
                  )}
                  <div>
                    <div className="pet-photo-actions">
                      <label className="secondary-button pet-photo-upload">
                        {completionPhotoFile ? t('petDetail.changePhoto') : t('appointments.addPhotoOptional')}
                        <input type="file" accept="image/*" onChange={handleCompletionPhotoChange} hidden />
                      </label>
                    </div>
                    <p className="pet-owner">{t('petDetail.pastePhotoHint')}</p>
                  </div>
                </div>
              </>
            )}
            <div className="record-edit-actions">
              <button type="button" className="primary-button" onClick={() => confirmPendingAction()} disabled={savingPending}>
                {savingPending
                  ? t('common.saving')
                  : pendingAction.kind === 'cancel'
                    ? t('appointments.confirmCancellation')
                    : pendingAction.kind === 'reschedule'
                      ? t('appointments.confirmReschedule')
                      : t('appointments.confirmCompletion')}
              </button>
              <button
                type="button"
                className="cancel-button"
                onClick={() => setPendingAction(null)}
                disabled={savingPending}
              >
                {t('appointments.confirmBack')}
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  if (loading) return <LoadingScreen />

  const query = search.trim().toLowerCase()
  const matchingAppointments = appointments.filter((a) => matchesAppointmentSearch(a, query))
  const activeAppointments = matchingAppointments.filter((a) => !ARCHIVED_STATUSES.has(a.status))
  const archivedAppointments = matchingAppointments.filter((a) => ARCHIVED_STATUSES.has(a.status))

  return (
    <div>
      <div className="page-header">
        <h1>{t('appointments.title')}</h1>
        <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
      </div>

      {error && <p className="form-error">{error}</p>}

      <input
        type="search"
        className="search-input"
        placeholder={t('appointments.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {query && (
        <p className="search-result-count">
          {t('appointments.resultCount', { count: String(matchingAppointments.length), total: String(appointments.length) })}
        </p>
      )}
      {query && matchingAppointments.length === 0 && (hasMoreActive || hasMorePast) && (
        <p className="search-result-count">{t('appointments.searchLoadMoreHint')}</p>
      )}

      {activeAppointments.length === 0 ? (
        <p>
          {query ? t('appointments.searchNoMatch', { query: search.trim() }) : t('appointments.noneUpcoming')}
          {!query && isVet && ` ${t('appointments.noneUpcomingHint')}`}
        </p>
      ) : (
        <ul className="pet-list">{activeAppointments.map(renderAppointment)}</ul>
      )}
      {hasMoreActive && (
        <button type="button" className="secondary-button" onClick={handleLoadMoreActive} disabled={loadingMoreActive}>
          {loadingMoreActive ? t('common.loading') : t('appointments.loadMoreUpcoming')}
        </button>
      )}

      {pastTotal > 0 && (
        <div className="archive-section">
          <button type="button" className="secondary-button" onClick={() => setShowArchive((v) => !v)}>
            {showArchive ? t('appointments.hidePast') : t('appointments.showPast')} ({pastTotal})
          </button>
          {showArchive && (
            <>
              <ul className="pet-list">{archivedAppointments.map(renderAppointment)}</ul>
              {hasMorePast && (
                <button type="button" className="secondary-button" onClick={handleLoadMorePast} disabled={loadingMorePast}>
                  {loadingMorePast ? t('common.loading') : t('appointments.loadMorePast')}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {isVet && (
        <form ref={scheduleFormRef} onSubmit={handleAddAppointment} className="pet-form pet-form-grid">
          <h2>{t('appointments.schedule')}</h2>
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
