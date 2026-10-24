import { cloneElement, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, CSSProperties, FormEvent, MouseEvent, ReactElement } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Calendar, dayjsLocalizer } from 'react-big-calendar'
import type { View } from 'react-big-calendar'
import dayjs from 'dayjs'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch, useBranchView } from '../lib/BranchContext'
import { ALL_BRANCHES, worksAt } from '../lib/branchChoice'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import type { Database } from '../lib/database.types'
import { visitTypeLabel } from '../lib/visitTypes'
import { STATUS_LABEL_KEYS, canWorkSession } from '../lib/appointmentStatus'
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
import BranchFilter from '../components/BranchFilter'
import VisitServices from '../components/VisitServices'
import PaymentStatusBadge from '../components/PaymentStatusBadge'
import { calendarCulture, clinicDay, formatDateTime, formatTime } from '../lib/format'
import { isAway } from '../lib/timeOff'
import FormError from '../components/FormError'
import Modal from '../components/Modal'
import BookingPetInfo from '../components/BookingPetInfo'

type Appointment = Database['public']['Tables']['appointments']['Row'] & {
  pets: { name: string; owner_name: string; owner_phone: string | null; pet_number: number } | null
  doctor: { full_name: string } | null
  starter: { clinic_role: string | null } | null
  invoice: { id: string; invoice_number: string; payment_status: string } | null // receptionists and managers only (0074)
}
type Pet = Database['public']['Tables']['pets']['Row']
type Profile = Database['public']['Tables']['profiles']['Row'] & { staff_branches: { branch_id: string }[] }
type MedicalRecord = Database['public']['Tables']['medical_records']['Row'] & { vet: { full_name: string } | null }
const RECORD_SELECT = '*, vet:profiles!medical_records_vet_id_fkey(full_name)'
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
  // Day view background block: the doctor's time off (reason only for managers).
  away?: { reason: string | null }
}
type AwayPeriod = Database['public']['Functions']['doctor_time_off_periods']['Returns'][number]
type CalendarResource = { id: string; title: string; subtitle: string | null }

const localizer = dayjsLocalizer(dayjs)
const APPOINTMENT_SELECT = '*, pets(name, owner_name, owner_phone, pet_number), doctor:profiles!appointments_doctor_fkey(full_name), invoice:invoices(id, invoice_number, payment_status), starter:profiles!appointments_started_by_fkey(clinic_role), billed'
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
  const { profile, handlesMoney } = useAuth()
  const { t, language } = useLanguage()
  const toast = useToast()
  const navigate = useNavigate()
  const { printSummary } = usePrintSummary()
  const isVet = profile?.role === 'vet'
  const confirm = useConfirm()
  const isClinician = profile?.clinic_role === 'doctor' || profile?.clinic_role === 'nurse'
  const { branchId, branchName, canWriteAt } = useBranch()
  // The calendar starts on the picked branch; anyone may look at another one or all (read-only overview).
  const [viewBranch, setViewBranch] = useBranchView()
  const viewingOther = branchId !== null && viewBranch !== branchId
  // New bookings go to the branch on screen (e.g. Main taking a call for North); "All branches" books at your own.
  const bookingBranchId = viewBranch !== ALL_BRANCHES ? viewBranch : branchId
  const bookingElsewhere = branchId !== null && bookingBranchId !== branchId
  // Other branches are read-only unless you work there (0076).
  const canBook = isVet && canWriteAt(bookingBranchId)

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [pets, setPets] = useState<Pet[]>([])
  const [staff, setStaff] = useState<Profile[]>([])
  const [awayPeriods, setAwayPeriods] = useState<AwayPeriod[]>([])
  const [awayReasons, setAwayReasons] = useState<Map<string, string>>(new Map())
  const [bookingAwayHint, setBookingAwayHint] = useState(false)
  const [rescheduleAwayHint, setRescheduleAwayHint] = useState(false)
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
  const [rescheduleDoctorId, setRescheduleDoctorId] = useState('')
  const [rescheduleConflicts, setRescheduleConflicts] = useState<Appointment[]>([])
  const [savingPanel, setSavingPanel] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  const [petId, setPetId] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledHour, setScheduledHour] = useState('')
  const [scheduledMinute, setScheduledMinute] = useState('')
  const [scheduledPeriod, setScheduledPeriod] = useState<'AM' | 'PM'>('AM')
  const [reason, setReason] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [conflicts, setConflicts] = useState<Appointment[]>([])
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false)
  const scheduleFormRef = useRef<HTMLFormElement>(null)
  // Booking form is a pop-up: "New appointment" or a slot click opens it (no scrolling to a form under the calendar).
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)

  // A slot click only fills date/time/doctor (one click to redo); warn for what was typed or picked by hand.
  useUnsavedChangesWarning(Boolean(petId || reason.trim()) || (selected !== null && panelMode !== 'details'))

  const { start: rangeStart, end: rangeEnd } = visibleRange(date, view)
  const rangeKey = `${rangeStart.getTime()}-${rangeEnd.getTime()}-${viewBranch}`

  async function loadRange() {
    let rangeQuery = supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .gte('scheduled_at', rangeStart.toISOString())
      .lt('scheduled_at', rangeEnd.toISOString())
    if (viewBranch !== ALL_BRANCHES) rangeQuery = rangeQuery.eq('branch_id', viewBranch)
    // Time off from today (or the shown range) onwards, so the booking forms know any future date.
    const awayFrom = new Date(Math.min(rangeStart.getTime(), dayjs().startOf('day').valueOf())).toISOString()
    const [{ data, error: loadError }, awayRes, reasonsRes] = await Promise.all([
      rangeQuery.order('scheduled_at', { ascending: true }),
      supabase.rpc('doctor_time_off_periods', { p_from: awayFrom, p_to: 'infinity' }),
      // RLS returns rows (with the reason) only to managers of that doctor.
      profile?.clinic_role === 'manager'
        ? supabase.from('doctor_time_off').select('id, reason').gt('ends_at', awayFrom)
        : Promise.resolve({ data: [] }),
    ])
    if (loadError) setError(loadError.message)
    else setAppointments(data ?? [])
    setAwayPeriods(awayRes.data ?? [])
    setAwayReasons(new Map((reasonsRes.data ?? []).map((r) => [r.id, r.reason])))
  }

  useEffect(() => {
    if (!profile?.clinic_id) return
    Promise.all([
      supabase.from('pets').select('*').is('deleted_at', null).order('name', { ascending: true }),
      supabase
        .from('profiles')
        .select('*, staff_branches(branch_id)')
        .eq('clinic_id', profile.clinic_id)
        .eq('takes_appointments', true)
        .eq('disabled', false)
        .order('calendar_order', { ascending: true, nullsFirst: false })
        .order('full_name', { ascending: true }),
    ]).then(([petsRes, staffRes]) => {
      setPets(petsRes.data ?? [])
      setStaff(staffRes.data ?? [])
    })
  }, [profile?.clinic_id])

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
        .select(RECORD_SELECT)
        .eq('appointment_id', appointment.id)
        .maybeSingle()
        .then(({ data }) => setRecord(data ?? null))
    }
  }

  function jumpTo(appointment: Appointment) {
    if (viewBranch !== ALL_BRANCHES && viewBranch !== appointment.branch_id) setViewBranch(appointment.branch_id)
    setDate(new Date(appointment.scheduled_at))
    setView('day')
    setSearch('')
    openAppointment(appointment)
  }

  // Links from elsewhere (Dashboard) open one appointment: /appointments?open=<id>.
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('open')
  // From the pet file's "New appointment": booking pop-up with that pet picked.
  const bookPetId = searchParams.get('pet')
  useEffect(() => {
    if (!bookPetId || !isVet) return
    setPetId(bookPetId)
    openBooking()
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookPetId])
  useEffect(() => {
    if (!openId) return
    supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('id', openId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          window.scrollTo(0, 0)
          jumpTo(data as Appointment)
        }
        setSearchParams({}, { replace: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  function startReschedule(appointment: Appointment) {
    const fields = toPickerFields(new Date(appointment.scheduled_at))
    setRescheduleDate(fields.date)
    setRescheduleHour(fields.hour)
    setRescheduleMinute(fields.minute)
    setReschedulePeriod(fields.period)
    // A doctor no longer in the picker (disabled, stopped taking appointments) starts as Unassigned.
    setRescheduleDoctorId(
      doctorsAt(appointment.branch_id).some((s) => s.id === appointment.doctor_id) ? (appointment.doctor_id ?? '') : '',
    )
    setRescheduleAwayHint(false)
    setRescheduleConflicts([])
    setPanelError(null)
    setPanelMode('reschedule')
  }

  // Confirm, step back to requested, check in or undo a check-in; the toast offers Undo (U18),
  // except on the undo itself.
  async function setRequestStatus(appointment: Appointment, status: 'confirmed' | 'requested' | 'arrived', undoable = true) {
    // Only from the status this screen shows, so a late Undo can't overwrite e.g. a session started meanwhile.
    const { data: changed, error: updateError } = await supabase
      .from('appointments')
      .update({ status })
      .eq('id', appointment.id)
      .eq('status', appointment.status)
      .select('id')
    if (updateError) {
      toast.error(updateError.message)
      return
    }
    if (!changed?.length) {
      toast.error(t('appointments.changedMeanwhile'))
      return
    }
    const updated = { ...appointment, status }
    applyUpdate(updated)
    const previous = appointment.status as 'confirmed' | 'requested' | 'arrived'
    toast.success(
      appointment.status === 'arrived' ? t('appointments.checkInUndone') : t('appointments.statusUpdated', { status: t(STATUS_LABEL_KEYS[status]) }),
      undoable ? { label: t('toast.undo'), onClick: () => setRequestStatus(updated, previous, false) } : undefined,
    )
    notifyStatusChange(appointment.id)
  }

  // Undo a session started by mistake: back to confirmed, timer cleared.
  async function handleStopSession(appointment: Appointment) {
    // Someone may be mid-way through the visit form on another screen.
    if (!(await confirm(t('session.stopConfirm'), { confirmLabel: t('session.stop') }))) return
    const changes = { status: 'confirmed', started_at: null }
    const { error: updateError } = await supabase.from('appointments').update(changes).eq('id', appointment.id)
    if (updateError) {
      toast.error(updateError.message)
      return
    }
    applyUpdate({ ...appointment, ...changes })
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
        doctorId: rescheduleDoctorId,
        scheduledAt: newScheduledAt,
        excludeAppointmentId: appointment.id,
      })
      if (found.length > 0) {
        setRescheduleConflicts(found)
        setSavingPanel(false)
        return
      }
    }
    // A checked-in pet moved to another day isn't waiting any more (nightly B9).
    const changes = {
      scheduled_at: newScheduledAt,
      doctor_id: rescheduleDoctorId || null,
      ...(appointment.status === 'arrived' && clinicDay(newScheduledAt) !== clinicDay() ? { status: 'confirmed' } : {}),
    }
    const { error: updateError } = await supabase.from('appointments').update(changes).eq('id', appointment.id)
    setSavingPanel(false)
    if (updateError) {
      setPanelError(updateError.message)
      return
    }
    const doctor = staff.find((s) => s.id === rescheduleDoctorId)
    applyUpdate({ ...appointment, ...changes, doctor: doctor ? { full_name: doctor.full_name } : null })
    toast.success(t('appointments.rescheduledToast'))
    notifyStatusChange(appointment.id)
  }

  useEffect(() => {
    setConflicts([])
    setConflictAcknowledged(false)
  }, [petId, doctorId, scheduledDate, scheduledHour, scheduledMinute, scheduledPeriod])

  async function handleAddAppointment(e: FormEvent) {
    e.preventDefault()
    setBookingError(null)

    if (!profile || !profile.clinic_id) {
      setBookingError(t('appointments.onlyStaffSchedule'))
      return
    }
    if (!petId) {
      setBookingError(t('appointments.choosePet'))
      return
    }
    if (!doctorId) {
      setBookingError(t('appointments.chooseStaff'))
      return
    }
    if (!scheduledDate || !scheduledHour || !scheduledMinute) {
      setBookingError(t('appointments.chooseDateTime'))
      return
    }

    const scheduledAt = toScheduledAt(scheduledDate, scheduledHour, scheduledMinute, scheduledPeriod)

    if (!conflictAcknowledged) {
      const found = await fetchConflicts({ petId, doctorId, scheduledAt })
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
        doctor_id: doctorId || null,
        created_by: profile.id,
        // No branch picked (clinic without one): a DB trigger fills the main branch; the generated type can't know that.
        ...(bookingBranchId ? { branch_id: bookingBranchId } : {}),
      } as Database['public']['Tables']['appointments']['Insert'])
      .select(APPOINTMENT_SELECT)
      .single()

    if (insertError) {
      setBookingError(insertError.message)
      setSubmitting(false)
      return
    }

    setPetId('')
    setScheduledDate('')
    setScheduledHour('')
    setScheduledMinute('')
    setScheduledPeriod('AM')
    setReason('')
    setDoctorId('')
    setBookingAwayHint(false)
    setConflicts([])
    setConflictAcknowledged(false)
    setSubmitting(false)
    setBookingOpen(false)
    toast.success(t('appointments.scheduled'))
    setAppointments((current) => mergeById(current, [newAppointment]))
    setSearchPool(null)
    if (viewBranch !== ALL_BRANCHES && viewBranch !== newAppointment.branch_id) setViewBranch(newAppointment.branch_id)
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
    if (resourceId && bookingStaff.some((s) => s.id === resourceId)) setDoctorId(String(resourceId))
    openBooking()
  }

  function openBooking() {
    setBookingError(null)
    setBookingOpen(true)
    // After the pop-up renders: ready to type the pet.
    requestAnimationFrame(() => scheduleFormRef.current?.querySelector<HTMLInputElement>('.pet-picker > input')?.focus())
  }

  async function closeBooking() {
    // Typed a pet or reason: ask before dropping it (date/time/doctor are one click to redo).
    if ((petId || reason.trim()) && !(await confirm(t('common.unsavedChangesConfirm')))) return
    setPetId('')
    setReason('')
    setBookingOpen(false)
  }

  // rbc only selects a slot after a long press on touch screens; a plain tap books too.
  // Slots carry their time + doctor (timeSlotWrapper below); find the one under the finger.
  const lastPointer = useRef('mouse')
  function handleCalendarTap(e: MouseEvent) {
    if (lastPointer.current !== 'touch' || (e.target as Element).closest('.rbc-event, .rbc-time-gutter, .rbc-time-header')) return
    const slot = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((el): el is HTMLElement => el instanceof HTMLElement && Boolean(el.dataset.slot) && Boolean(el.closest('.rbc-day-slot')))
    if (slot) handleSelectSlot({ start: new Date(slot.dataset.slot!), resourceId: slot.dataset.resource || undefined })
  }


  // A doctor can only be booked at a branch they work at.
  function doctorsAt(id: string | null) {
    return id ? staff.filter((s) => worksAt(s, id)) : staff
  }
  // Doctors on time off at the chosen time are not offered (the DB refuses them too).
  const scheduledAt =
    scheduledDate && scheduledHour && scheduledMinute
      ? toScheduledAt(scheduledDate, scheduledHour, scheduledMinute, scheduledPeriod)
      : null
  const bookingStaff = doctorsAt(bookingBranchId).filter((s) => !scheduledAt || !isAway(awayPeriods, s.id, scheduledAt))
  // Switching the viewed branch or the time can drop the chosen doctor from the list.
  if (doctorId && !bookingStaff.some((s) => s.id === doctorId)) {
    setBookingAwayHint(doctorsAt(bookingBranchId).some((s) => s.id === doctorId))
    setDoctorId('')
  }
  const rescheduleAt =
    selected && panelMode === 'reschedule' && rescheduleDate && rescheduleHour && rescheduleMinute
      ? toScheduledAt(rescheduleDate, rescheduleHour, rescheduleMinute, reschedulePeriod)
      : null
  if (rescheduleAt && rescheduleDoctorId && isAway(awayPeriods, rescheduleDoctorId, rescheduleAt)) {
    setRescheduleDoctorId('')
    setRescheduleAwayHint(true)
  }
  const columnStaff = useMemo(
    () => (viewBranch === ALL_BRANCHES ? staff : staff.filter((s) => worksAt(s, viewBranch))),
    [staff, viewBranch],
  )
  const staffIds = useMemo(() => new Set(columnStaff.map((s) => s.id)), [columnStaff])
  const events: CalendarEvent[] = useMemo(() => {
    const visible = appointments.filter((a) => a.status !== 'cancelled')
    if (view === 'week') {
      // The box shows the count (user: no more detail in week view); its tooltip lists who.
      const byHour = new Map<number, string[]>()
      for (const a of visible) {
        const hour = dayjs(a.scheduled_at).startOf('hour').valueOf()
        byHour.set(hour, [...(byHour.get(hour) ?? []), `${formatTime(a.scheduled_at)} ${a.pets?.name ?? t('dashboard.unknownPet')}`])
      }
      return Array.from(byHour, ([hour, names]) => ({
        id: `hour-${hour}`,
        title: names.join('\n'),
        count: names.length,
        start: new Date(hour),
        end: new Date(hour + 60 * 60_000),
        resourceId: UNASSIGNED,
        appointment: null,
      }))
    }
    return visible.map((a) => {
      const start = new Date(a.scheduled_at)
      return {
        id: a.id,
        title: a.pets?.name ?? t('dashboard.unknownPet'),
        start,
        end: new Date(start.getTime() + SLOT_MS),
        // Unassigned also catches appointments whose doctor was disabled or stopped taking appointments.
        resourceId: a.doctor_id && staffIds.has(a.doctor_id) ? a.doctor_id : UNASSIGNED,
        appointment: a,
        count: 1,
      }
    })
  }, [appointments, staffIds, t, view])
  // Gray "Away" blocks in the doctor's column, clipped to the shown day.
  const awayEvents: CalendarEvent[] =
    view === 'day'
      ? awayPeriods
          .filter((p) => staffIds.has(p.doctor_id) && new Date(p.starts_at) < rangeEnd && new Date(p.ends_at) > rangeStart)
          .map((p) => ({
            id: `away-${p.id}`,
            title: t('calendar.away'),
            start: new Date(Math.max(new Date(p.starts_at).getTime(), rangeStart.getTime())),
            end: new Date(Math.min(new Date(p.ends_at).getTime(), rangeEnd.getTime())),
            resourceId: p.doctor_id,
            appointment: null,
            count: 0,
            away: { reason: awayReasons.get(p.id) ?? null },
          }))
      : []

  // Header pill: plain "Away" for the whole day, otherwise the hours, so a doctor
  // away only in the evening doesn't look off all day.
  function awayTag(resourceId: string) {
    const periods = awayEvents.filter((e) => e.resourceId === resourceId)
    if (periods.length === 0) return null
    const wholeDay = periods.some((e) => e.start <= rangeStart && e.end.getTime() >= rangeEnd.getTime() - 60_000)
    return (
      <span className="calendar-away-tag">
        {t('calendar.away')}
        {!wholeDay && (
          <>
            {' '}
            <Ltr>
              {formatTime(periods[0].start)}–{formatTime(periods[0].end)}
            </Ltr>
          </>
        )}
      </span>
    )
  }
  const hasUnassigned = view === 'day' && events.some((e) => e.resourceId === UNASSIGNED)
  // Opens at 8 AM, or earlier if the first visible appointment is before that.
  // Only events inside the shown range count: right after navigating, the
  // previous range's events are still loaded for a moment.
  const eightAm = dayjs(date).startOf('day').add(8, 'hour')
  const firstStart = events
    .filter((e) => e.start >= rangeStart && e.start < rangeEnd)
    .reduce<Date | null>((min, e) => (!min || e.start < min ? e.start : min), null)
  const scrollTo = firstStart && dayjs(firstStart).hour() < 8 ? firstStart : eightAm.toDate()
  // Time of day only; the library applies scrollToTime on mount, so a new target remounts it.
  const scrollKey = dayjs(scrollTo).format('HH:mm')
  const resources: CalendarResource[] = [
    ...columnStaff.map((s) => ({ id: s.id, title: s.full_name, subtitle: s.title })),
    ...(hasUnassigned || columnStaff.length === 0 ? [{ id: UNASSIGNED, title: t('calendar.unassigned'), subtitle: null }] : []),
  ]

  const query = search.trim()
  const searchResults = query && searchPool ? searchPool.filter((a) => matchesAppointmentSearch(a, query)).slice(0, 8) : []

  if (loading) return <LoadingScreen />

  function renderPanel(appointment: Appointment) {
    const isActive = ['requested', 'confirmed', 'arrived'].includes(appointment.status)
    const inSession = appointment.status === 'in_session'
    return (
      <Modal onClose={() => !savingPanel && setSelected(null)} labelledBy="appointment-panel-title" className="appointment-panel">
          <div className="appointment-panel-header">
            <div>
              <h2 id="appointment-panel-title">{appointment.pets?.name ?? t('dashboard.unknownPet')}</h2>
              {appointment.pets && (
                <p className="pet-owner">
                  {t('pets.petId')}: <Ltr>{appointment.pets.pet_number}</Ltr> · {t('pets.owner')}: {appointment.pets.owner_name}
                  {appointment.pets.owner_phone && (
                    <>
                      {' · '}
                      <a href={`tel:${appointment.pets.owner_phone}`}>
                        <Ltr>{appointment.pets.owner_phone}</Ltr>
                      </a>
                    </>
                  )}
                </p>
              )}
              <p className="pet-owner">
                <Ltr>{formatDateTime(appointment.scheduled_at)}</Ltr>
                {appointment.doctor && ` · ${appointment.doctor.full_name}`}
                {viewBranch === ALL_BRANCHES && branchName(appointment.branch_id) && ` · ${branchName(appointment.branch_id)}`}
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

          <FormError message={panelError} />

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
                    <option value="AM">{t('time.am')}</option>
                    <option value="PM">{t('time.pm')}</option>
                  </select>
                </div>
              </label>
              <label>
                {t('appointments.staffHandling')}
                <select
                  value={rescheduleDoctorId}
                  onChange={(e) => {
                    setRescheduleDoctorId(e.target.value)
                    setRescheduleAwayHint(false)
                    setRescheduleConflicts([])
                  }}
                >
                  <option value="">{t('calendar.unassigned')}</option>
                  {doctorsAt(appointment.branch_id)
                    .filter((s) => !rescheduleAt || !isAway(awayPeriods, s.id, rescheduleAt))
                    .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name}
                      {member.title ? ` — ${member.title}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {rescheduleAwayHint && !rescheduleDoctorId && <p className="pet-owner">{t('appointments.doctorAwayCleared')}</p>}
              {rescheduleConflicts.length > 0 && (
                <div className="form-warning">
                  <p>{t('appointments.conflictWarning', { count: String(rescheduleConflicts.length) })}</p>
                  <ul>
                    {rescheduleConflicts.map((c) => (
                      <li key={c.id}>
                        {c.pets?.name ?? t('dashboard.unknownPet')} — <Ltr>{formatDateTime(c.scheduled_at)}</Ltr>
                        {c.doctor?.full_name ? ` (${c.doctor.full_name})` : ''}
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
                            doctor: record.vet?.full_name,
                            owner: [appointment.pets?.owner_name, appointment.pets?.owner_phone && `⁦${appointment.pets.owner_phone}⁩`].filter(Boolean).join(' · '),
                            record,
                            photoUrl: includePhoto ? record.photo_url : null,
                          }, appointment.pets?.pet_number)
                        }
                      >
                        {t('common.print')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="pet-owner">{t('appointments.noRecord')}</p>
                ))}

              {appointment.status === 'completed' && (
                <VisitServices appointmentId={appointment.id} locked={Boolean(appointment.billed)} />
              )}
              {appointment.invoice && (
                <p className="pet-owner">
                  <PaymentStatusBadge status={appointment.invoice.payment_status} /> <Ltr>{appointment.invoice.invoice_number}</Ltr>
                </p>
              )}

              <div className="appointment-panel-actions">
                {handlesMoney && appointment.status === 'completed' && !appointment.billed && (
                  <button type="button" className="primary-button" onClick={() => navigate(`/payments?bill=${appointment.id}`)}>
                    {t('visitServices.billVisit')}
                  </button>
                )}
                {/* Only its starter (plus the other clinician role) resumes a session (0075). */}
                {inSession && canWriteAt(appointment.branch_id) && canWorkSession(profile?.clinic_role, profile?.id, appointment.started_by, appointment.starter?.clinic_role) && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => navigate(`/appointments/${appointment.id}/session`)}
                    autoFocus
                  >
                    {t('session.resume')}
                  </button>
                )}
                {isVet && canWriteAt(appointment.branch_id) && inSession && (
                  <>
                    <button type="button" className="secondary-button" onClick={() => handleStopSession(appointment)}>
                      {t('session.stop')}
                    </button>
                    <button type="button" className="delete-button" onClick={() => setPanelMode('cancel')}>
                      {t('appointments.cancelAppointment')}
                    </button>
                  </>
                )}
                {isVet && canWriteAt(appointment.branch_id) && isActive && (
                  <>
                    {appointment.status === 'requested' && (
                      <button
                        type="button"
                        className={isClinician ? 'secondary-button' : 'primary-button'}
                        onClick={() => setRequestStatus(appointment, 'confirmed')}
                        autoFocus
                      >
                        {t('appointments.confirmAppointment')}
                      </button>
                    )}
                    {/* Only doctors and nurses run sessions (0075); for reception, confirming is the main job. */}
                    {isClinician && (
                      <button type="button" className="primary-button" onClick={() => navigate(`/appointments/${appointment.id}/session`)}>
                        {t('session.start')}
                      </button>
                    )}
                    <button type="button" className="secondary-button" onClick={() => startReschedule(appointment)}>
                      {t('appointments.reschedule')}
                    </button>
                    {/* Check-in: reception marks the pet as here, so doctors see who is waiting (P3). */}
                    {appointment.status !== 'arrived' && clinicDay(appointment.scheduled_at) === clinicDay() && (
                      <button type="button" className="secondary-button" onClick={() => setRequestStatus(appointment, 'arrived')}>
                        {t('appointments.markArrived')}
                      </button>
                    )}
                    {appointment.status === 'arrived' && (
                      <button type="button" className="secondary-button" onClick={() => setRequestStatus(appointment, 'confirmed')}>
                        {t('appointments.notArrived')}
                      </button>
                    )}
                    {appointment.status === 'confirmed' && (
                      <button type="button" className="secondary-button" onClick={() => setRequestStatus(appointment, 'requested')}>
                        {t('appointments.unconfirm')}
                      </button>
                    )}
                    <button type="button" className="delete-button" onClick={() => setPanelMode('cancel')}>
                      {t('appointments.cancelAppointment')}
                    </button>
                  </>
                )}
                <button type="button" className="cancel-button" onClick={() => setSelected(null)}>
                  {t('common.close')}
                </button>
              </div>
            </>
          )}
      </Modal>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('appointments.title')}</h1>
        <div className="page-header-actions">
          <BranchFilter value={viewBranch} onChange={setViewBranch} />
          <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
          {canBook && (
            <button type="button" className="primary-button" onClick={openBooking}>
              + {t('appointments.newAppointment')}
            </button>
          )}
        </div>
      </div>
      {canBook && viewBranch !== ALL_BRANCHES && <p className="pet-owner">{t('calendar.slotHint')}</p>}
      {viewingOther && (
        <p className="pet-owner">
          {viewBranch === ALL_BRANCHES
            ? t('branch.viewingOther', { name: t('staff.allBranches'), current: branchName(branchId) })
            : t(canWriteAt(viewBranch) ? 'branch.bookingAt' : 'branch.viewOnly', { name: branchName(viewBranch) })}
        </p>
      )}

      <FormError message={error} />

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
                    <Ltr>{formatDateTime(a.scheduled_at)}</Ltr>
                    {a.doctor && <span>{a.doctor.full_name}</span>}
                    <span className={`status-badge status-${a.status}`}>{t(STATUS_LABEL_KEYS[a.status])}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Follows the page direction: Arabic mirrors the calendar (user, 2026-10-23). */}
      <div className="appointments-layout">
      <div className="appointments-side">
        <MiniMonth value={date} onChange={setDate} />
        {/* Cancelled appointments never show on the calendar, so these colours cover it. */}
        <div className="calendar-legend" dir={language === 'ar' ? 'rtl' : 'ltr'}>
          <h2>{t('appointments.legend')}</h2>
          <ul>
            {(['requested', 'confirmed', 'arrived', 'in_session', 'completed'] as const).map((status) => (
              <li key={status}>
                <span className={`calendar-legend-swatch status-${status}`} aria-hidden />
                {t(STATUS_LABEL_KEYS[status])}
              </li>
            ))}
            {handlesMoney && (
              <li>
                <span className="calendar-unpaid">{t('visitServices.unpaid')}</span>
                {t('visitServices.unpaidLegend')}
              </li>
            )}
          </ul>
        </div>
      </div>
      {/* --now-cols centres the "Now" pill across all doctor columns (see App.css). */}
      <div
        className="appointments-calendar"
        onPointerDown={(e) => (lastPointer.current = e.pointerType)}
        onClick={canBook && viewBranch !== ALL_BRANCHES ? handleCalendarTap : undefined}
        style={
          {
            '--now-label': JSON.stringify(t('calendar.now')),
            '--now-cols': view === 'day' ? resources.length : 1,
          } as CSSProperties
        }
      >
        <Calendar<CalendarEvent, CalendarResource>
          key={scrollKey}
          localizer={localizer}
          culture={calendarCulture(language)}
          rtl={language === 'ar'}
          // 12-hour like the booking form, also in Arabic (its locale default is 24-hour).
          formats={{ timeGutterFormat: 'h:mm A', eventTimeRangeFormat: ({ start, end }, culture, loc) => `${loc!.format(start, 'h:mm A', culture)} – ${loc!.format(end, 'h:mm A', culture)}` }}
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
          selectable={canBook && viewBranch !== ALL_BRANCHES}
          onSelectSlot={handleSelectSlot}
          backgroundEvents={awayEvents}
          onSelectEvent={(event) => {
            if (event.away) return
            if (event.appointment) return openAppointment(event.appointment)
            // A week-view hour box opens that day with the individual appointments.
            setDate(event.start)
            setView('day')
          }}
          slotPropGetter={(_date, resourceId) => (resourceId === UNASSIGNED ? { className: 'calendar-slot-unassigned' } : {})}
          eventPropGetter={(event) => ({
            className: event.away
              ? 'calendar-away'
              : event.appointment
                ? `calendar-event status-${event.appointment.status}`
                : 'calendar-hour-count',
          })}
          components={{
            timeSlotWrapper: (({ value, resource, children }: { value: Date; resource?: string | number | null; children: ReactElement }) =>
              cloneElement(children as ReactElement<Record<string, string>>, { 'data-slot': value.toISOString(), 'data-resource': resource ? String(resource) : '' })) as ComponentType,
            event: ({ event }) =>
              event.away ? (
                <span className="calendar-event-content">
                  <strong>{event.title}</strong>
                  {event.away.reason && <span>{event.away.reason}</span>}
                </span>
              ) : event.appointment ? (
                <span className="calendar-event-content">
                  <strong>
                    {event.title}
                    {viewBranch === ALL_BRANCHES && ` · ${branchName(event.appointment.branch_id)}`}
                    {/* Beside the name: a 30-minute block has room for two lines only. */}
                    {handlesMoney && event.appointment.status === 'completed' && event.appointment.invoice?.payment_status !== 'paid' && (
                      <>
                        {' '}
                        <span className="calendar-unpaid">
                          {t(event.appointment.invoice?.payment_status === 'partly_paid' ? 'payments.statusPartlyPaid' : 'visitServices.unpaid')}
                        </span>
                      </>
                    )}
                  </strong>
                  {event.appointment.reason && <span>{event.appointment.reason}</span>}
                </span>
              ) : (
                <span className="calendar-hour-count-content">
                  <strong>{event.count}</strong>
                  <span>{t(event.count === 1 ? 'calendar.appointmentOne' : 'calendar.appointmentMany')}</span>
                </span>
              ),
            resourceHeader: ({ resource }) =>
              resource.id === UNASSIGNED ? (
                <span className="calendar-resource-header is-unassigned">
                  <strong>{resource.title}</strong>
                  <span>{t('calendar.needsDoctor')}</span>
                </span>
              ) : (
                <span className="calendar-resource-header">
                  <strong>{resource.title}</strong>
                  {/* The block can start above the scrolled-to 8 AM, so the header says it too. */}
                  {awayTag(String(resource.id)) ?? (resource.subtitle && <span>{resource.subtitle}</span>)}
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

      {isVet && bookingOpen && (
        <Modal onClose={closeBooking} labelledBy="booking-title" className="booking-modal">
        <form ref={scheduleFormRef} onSubmit={handleAddAppointment} className="pet-form pet-form-grid">
          <h2 id="booking-title">{t('appointments.schedule')}</h2>
          <FormError message={bookingError} />
          {bookingElsewhere && (
            <p className="pet-owner appointment-schedule-hint">{t('branch.bookingAt', { name: branchName(bookingBranchId) })}</p>
          )}
          <label>
            {t('appointments.pet')}
            <RequiredMark />
            <PetPicker pets={pets} value={petId} onChange={setPetId} />
          </label>
          {pets.find((p) => p.id === petId) && <BookingPetInfo pet={pets.find((p) => p.id === petId)!} />}
          <label>
            {t('appointments.date')}
            <RequiredMark />
            <input type="date" dir="ltr" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} required />
          </label>
          <label>
            {t('appointments.time')}
            <RequiredMark />
            <div className="time-select" dir="ltr">
              <select aria-label={t('appointments.hour')} value={scheduledHour} onChange={(e) => setScheduledHour(e.target.value)} required>
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
              <select aria-label={t('appointments.minute')} value={scheduledMinute} onChange={(e) => setScheduledMinute(e.target.value)} required>
                <option value="" disabled>
                  {t('appointments.min')}
                </option>
                {['00', '15', '30', '45'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select aria-label={t('appointments.amPm')} value={scheduledPeriod} onChange={(e) => setScheduledPeriod(e.target.value as 'AM' | 'PM')}>
                <option value="AM">{t('time.am')}</option>
                <option value="PM">{t('time.pm')}</option>
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
            <select
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value)
                setBookingAwayHint(false)
              }}
              required
            >
              <option value="" disabled>
                {t('appointments.selectStaffMember')}
              </option>
              {bookingStaff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                  {member.title ? ` — ${member.title}` : ''}
                </option>
              ))}
            </select>
            {bookingAwayHint && !doctorId && <span className="pet-owner">{t('appointments.doctorAwayCleared')}</span>}
          </label>
          {conflicts.length > 0 && (
            <div className="form-warning">
              <p>{t('appointments.conflictWarning', { count: String(conflicts.length) })}</p>
              <ul>
                {conflicts.map((c) => (
                  <li key={c.id}>
                    {c.pets?.name ?? t('dashboard.unknownPet')} — <Ltr>{formatDateTime(c.scheduled_at)}</Ltr>
                    {c.doctor?.full_name ? ` (${c.doctor.full_name})` : ''}
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
          <div className="record-edit-actions">
            <button type="submit" disabled={submitting}>
              {submitting ? t('common.saving') : t('appointments.scheduleSubmit')}
            </button>
            <button type="button" className="cancel-button" onClick={closeBooking}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
        </Modal>
      )}
    </div>
  )
}

export default AppointmentsPage
