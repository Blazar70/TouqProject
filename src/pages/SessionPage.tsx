import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Timer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { VISIT_TYPES, visitTypeLabel } from '../lib/visitTypes'
import PrescriptionEditor from '../components/PrescriptionEditor'
import TemplatePicker from '../components/TemplatePicker'
import { idleGuards } from '../lib/idleLogout'
import { editToRecord, isDoctorOnlyField, parseVitals, recordToEdit } from '../lib/clinicalFields'
import type { RecordColumns, RecordEdit } from '../lib/clinicalFields'
import { canWorkSession } from '../lib/appointmentStatus'
import { uploadPhoto, validateImageFile } from '../lib/imageUpload'
import { usePasteImage } from '../lib/usePasteImage'
import { useDropImage } from '../lib/useDropImage'
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning'
import { notifyStatusChange } from '../lib/push'
import { useToast } from '../lib/ToastContext'
import LoadingScreen from '../components/LoadingScreen'
import RequiredMark from '../components/RequiredMark'
import Ltr from '../components/Ltr'
import VisitServices from '../components/VisitServices'
import FormError from '../components/FormError'
import SessionHistory from '../components/SessionHistory'

const SESSION_SELECT = '*, pets(name, species, breed, owner_name, owner_phone), starter:profiles!appointments_started_by_fkey(full_name, clinic_role), billed'

type Appointment = Database['public']['Tables']['appointments']['Row'] & {
  pets: { name: string; species: string; breed: string | null; owner_name: string; owner_phone: string | null } | null
  starter: { full_name: string; clinic_role: string | null } | null
}
type MedicalRecord = Database['public']['Tables']['medical_records']['Row']

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

async function loadRecord(appointmentId: string) {
  const { data } = await supabase.from('medical_records').select('*').eq('appointment_id', appointmentId).order('created_at').limit(1).maybeSingle()
  return data
}

function SessionPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { branchId } = useBranch()
  const { t } = useLanguage()
  const toast = useToast()
  const role = profile?.clinic_role
  const isClinician = role === 'doctor' || role === 'nurse'
  const isNurse = role === 'nurse'

  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // One visit record per session, shared by the doctor and the nurse (0075): saved as they go.
  const [record, setRecord] = useState<MedicalRecord | null>(null)
  const [form, setForm] = useState<RecordEdit>(() => recordToEdit(null))
  const setField = (field: keyof RecordEdit, value: string) => setForm((f) => ({ ...f, [field]: value }))
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const dirty = Boolean(photoFile) || JSON.stringify(form) !== JSON.stringify(recordToEdit(record))
  useUnsavedChangesWarning(dirty && !done)
  // An idle sign-out saves the half-written record first instead of losing it (nightly B25).
  const saveRef = useRef<() => Promise<unknown>>(async () => {})
  useEffect(() => {
    if (!dirty || done) return
    const save = () => saveRef.current()
    idleGuards.savers.add(save)
    return () => {
      idleGuards.savers.delete(save)
    }
  }, [dirty, done])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    supabase
      .from('appointments')
      .select(SESSION_SELECT)
      .eq('id', id)
      .maybeSingle()
      .then(async ({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        // Opening the session starts it: in_session (with its start time) until Finish,
        // so everyone sees the pet is being worked on and the timer survives other devices.
        // Only doctors and nurses start one; the DB records who (started_by).
        if (data && isClinician && ['requested', 'confirmed', 'arrived'].includes(data.status)) {
          const { data: started, error: startError } = await supabase
            .from('appointments')
            .update({ status: 'in_session', started_at: new Date().toISOString() })
            .eq('id', data.id)
            .in('status', ['requested', 'confirmed', 'arrived'])
            .select(SESSION_SELECT)
            .maybeSingle()
          if (startError) setError(startError.message)
          if (started) {
            notifyStatusChange(started.id)
            data = started
          } else if (!startError) {
            // Another open (second device, StrictMode re-run) started it first: use its started_at.
            const { data: current } = await supabase.from('appointments').select(SESSION_SELECT).eq('id', data.id).maybeSingle()
            if (current) data = current
          }
        }
        if (data) {
          const existing = await loadRecord(data.id)
          setRecord(existing)
          setForm(recordToEdit(existing))
        }
        setAppointment(data)
        setLoading(false)
      })
  }, [id, isClinician])

  const startedAt = appointment?.started_at ? new Date(appointment.started_at).getTime() : now

  useEffect(() => () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
  }, [photoPreviewUrl])

  const processPhotoFile = useCallback(
    (file: File) => {
      const validationError = validateImageFile(file)
      if (validationError) {
        setError(validationError === 'notImage' ? t('petDetail.imageOnly') : t('petDetail.imageTooLarge'))
        return
      }
      setError(null)
      setPhotoPreviewUrl(URL.createObjectURL(file))
      setPhotoFile(file)
    },
    [t],
  )

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) processPhotoFile(file)
  }

  usePasteImage(processPhotoFile, true)
  const { dragActive, dragHandlers } = useDropImage(processPhotoFile, true)

  // Writes only the fields changed on this screen, so the doctor and the nurse don't
  // overwrite each other's work; returns the merged record.
  // shortcut: no live sync; each person sees the other's changes on their next save or reload. Add realtime if that bites.
  saveRef.current = () => saveRecord()
  async function saveRecord(): Promise<MedicalRecord | null> {
    if (!appointment || !profile?.clinic_id) return null
    const vitalsResult = parseVitals(form)
    if (!vitalsResult.ok) {
      setError(t(vitalsResult.errorKey))
      return null
    }
    const before = record ?? {}
    const changes = Object.fromEntries(
      Object.entries(editToRecord(form, vitalsResult.vitals)).filter(
        ([column, value]) => !(isNurse && isDoctorOnlyField(column)) && value !== ((before as Record<string, unknown>)[column] ?? null),
      ),
    ) as RecordColumns
    const target = record ?? (await loadRecord(appointment.id))
    let { data: saved, error: recordError } = target
      ? await supabase.from('medical_records').update(changes).eq('id', target.id).select().single()
      : await supabase
          .from('medical_records')
          .insert({
            ...changes,
            pet_id: appointment.pet_id,
            clinic_id: profile.clinic_id,
            appointment_id: appointment.id,
            // The visit happened when the session started, not when Finish was pressed (may be the next day).
            visit_date: appointment.started_at ?? undefined,
            branch_id: branchId,
          })
          .select()
          .single()
    // The other person's first save landed a moment earlier (one record per visit, 0088): save into theirs.
    if (recordError?.code === '23505') {
      const theirs = await loadRecord(appointment.id)
      if (theirs) ({ data: saved, error: recordError } = await supabase.from('medical_records').update(changes).eq('id', theirs.id).select().single())
    }
    if (recordError || !saved) {
      setError(t('appointments.recordFailed', { error: recordError?.message ?? '' }))
      return null
    }
    let result = saved
    // The record is saved at this point; a failed photo upload is worth surfacing but doesn't undo it.
    if (photoFile) {
      const upload = await uploadPhoto(`${profile.clinic_id}/records/${saved.id}`, photoFile)
      if (upload.error !== null) {
        toast.error(t('common.couldNotSavePhoto'))
      } else {
        const { data: withPhoto } = await supabase.from('medical_records').update({ photo_url: upload.path }).eq('id', saved.id).select().single()
        if (withPhoto) result = withPhoto
      }
      setPhotoFile(null)
      setPhotoPreviewUrl(null)
    }
    setRecord(result)
    setForm(recordToEdit(result))
    return result
  }

  async function handleSave() {
    setError(null)
    setSaving(true)
    if (await saveRecord()) toast.success(t('petDetail.recordSaved'))
    setSaving(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!appointment) return
    setError(null)

    if (!profile?.clinic_id) {
      setError(t('appointments.onlyStaffComplete'))
      return
    }
    // A nurse may finish alone (weigh-in etc.); the doctor's diagnosis and treatment stay required for doctors.
    if (!form.visitType || (!isNurse && (!form.diagnosis.trim() || !form.treatment.trim()))) {
      setError(t('appointments.completionRequired'))
      return
    }

    // Record first, then the status: a completed appointment never lacks its record.
    setSaving(true)
    if (!(await saveRecord())) {
      setSaving(false)
      return
    }
    const { error: appointmentError } = await supabase
      .from('appointments')
      .update({ status: 'completed' })
      .eq('id', appointment.id)
    if (appointmentError) {
      // The record stays saved (it belongs to this session); pressing Finish again updates it.
      setError(appointmentError.message)
      setSaving(false)
      return
    }

    toast.success(t('appointments.completedToast'))
    notifyStatusChange(appointment.id)
    setDone(true)
  }

  // After the render that turns the unsaved-changes guard off, or it would block this.
  useEffect(() => {
    // Back on the finished visit (its day, dialog open: Bill this visit), not today's page.
    if (done) navigate(`/appointments?open=${id}`)
  }, [done, navigate, id])

  if (loading) return <LoadingScreen />

  if (!appointment || appointment.status === 'completed' || appointment.status === 'cancelled') {
    return (
      <div>
        <FormError message={error} />
        <p>{appointment ? t('session.notActive') : t('session.notFound')}</p>
        <button type="button" className="secondary-button" onClick={() => navigate('/appointments')}>
          {t('session.backToAppointments')}
        </button>
      </div>
    )
  }

  // Reception/managers, or a second doctor on someone else's session: no form (the DB refuses it too).
  if (appointment.status !== 'in_session' || !canWorkSession(role, profile?.id, appointment.started_by, appointment.starter?.clinic_role)) {
    return (
      <div>
        <FormError message={error} />
        <p>
          {appointment.status === 'in_session' && appointment.starter
            ? t('session.lockedBy', { name: appointment.starter.full_name })
            : t('session.cliniciansOnly')}
        </p>
        <button type="button" className="secondary-button" onClick={() => navigate('/appointments')}>
          {t('session.backToAppointments')}
        </button>
      </div>
    )
  }

  return (
    <div className="session-page">
      <div className="session-header">
        <div>
          <p className="session-eyebrow">{t('session.title')}</p>
          <h1>{appointment.pets?.name ?? t('dashboard.unknownPet')}</h1>
          <p className="pet-owner">
            {appointment.pets?.species}
            {appointment.pets?.breed ? ` (${appointment.pets.breed})` : ''} · {t('pets.owner')}: {appointment.pets?.owner_name}
            {appointment.pets?.owner_phone && (
              <>
                {' · '}
                <Ltr>{appointment.pets.owner_phone}</Ltr>
              </>
            )}
          </p>
          {appointment.reason && (
            <p className="pet-owner">
              {t('appointments.reasonLabel')}: {appointment.reason}
            </p>
          )}
        </div>
        <div className="session-timer" role="timer" aria-label={t('session.elapsed')}>
          <Timer size={20} aria-hidden />
          <Ltr>{formatElapsed(now - startedAt)}</Ltr>
        </div>
      </div>

      <FormError message={error} />

      <div className="session-body">
      <div className="session-main">
      {/* Outside the form: Enter in a quantity box must not finish the session. Saved as they're added. */}
      <VisitServices appointmentId={appointment.id} locked={Boolean(appointment.billed)} />

      <form onSubmit={handleSubmit} className="pet-form session-form">
        <label>
          {t('petDetail.visitType')}
          <RequiredMark />
          <select value={form.visitType} onChange={(e) => setField('visitType', e.target.value)} required>
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
        <TemplatePicker form={form} onApply={setForm} />
        <label>
          {t('clinical.presentingComplaint')}
          <textarea value={form.complaint} onChange={(e) => setField('complaint', e.target.value)} rows={2} />
        </label>
        {/* Numbers read left-to-right even in Arabic, hence dir="ltr" on the inputs only. */}
        <div className="vitals-row">
          <label>
            {t('clinical.weightKg')}
            <input type="text" inputMode="decimal" dir="ltr" value={form.weight} onChange={(e) => setField('weight', e.target.value)} />
          </label>
          <label>
            {t('clinical.temperatureC')}
            <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={form.temperature}
              onChange={(e) => setField('temperature', e.target.value)}
            />
          </label>
          <label>
            {t('clinical.heartRateBpm')}
            <input type="text" inputMode="numeric" dir="ltr" value={form.heartRate} onChange={(e) => setField('heartRate', e.target.value)} />
          </label>
        </div>
        <label>
          {t('clinical.physicalExam')}
          <textarea value={form.physicalExam} onChange={(e) => setField('physicalExam', e.target.value)} rows={3} />
        </label>
        {/* The doctor's part of the shared record; nurses don't see or write it (0075). */}
        {!isNurse && (
          <>
            <label>
              {t('petDetail.diagnosis')}
              <RequiredMark />
              <input value={form.diagnosis} onChange={(e) => setField('diagnosis', e.target.value)} required />
            </label>
            <label>
              {t('clinical.diagnosticPlan')}
              <textarea value={form.diagnosticPlan} onChange={(e) => setField('diagnosticPlan', e.target.value)} rows={2} />
            </label>
            <label>
              {t('petDetail.treatment')}
              <RequiredMark />
              <input value={form.treatment} onChange={(e) => setField('treatment', e.target.value)} required />
            </label>
            <PrescriptionEditor lines={form.prescription} onChange={(lines) => setForm((f) => ({ ...f, prescription: lines }))} />
          </>
        )}
        <label>
          {t('clinical.remarks')}
          <textarea value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} rows={2} />
        </label>
        <div className={`pet-photo-row${dragActive ? ' pet-photo-row-drag-active' : ''}`} {...dragHandlers}>
          {photoPreviewUrl && <img src={photoPreviewUrl} alt="" className="pet-avatar" style={{ width: 56, height: 56 }} />}
          <div>
            <div className="pet-photo-actions">
              <label className="secondary-button pet-photo-upload">
                {photoFile ? t('petDetail.changePhoto') : t('appointments.addPhotoOptional')}
                <input type="file" accept="image/*" onChange={handlePhotoChange} />
              </label>
            </div>
            <p className="pet-owner">{t('petDetail.pastePhotoHint')}</p>
          </div>
        </div>
        <div className="record-edit-actions">
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? t('common.saving') : t('session.finish')}
          </button>
          {/* Saves without finishing, so the other clinician in the session sees it. */}
          <button type="button" className="secondary-button" onClick={handleSave} disabled={saving}>
            {t('common.save')}
          </button>
          <button type="button" className="cancel-button" onClick={() => navigate('/appointments')}>
            {t('session.backToAppointments')}
          </button>
        </div>
      </form>
      </div>
      <SessionHistory petId={appointment.pet_id} />
      </div>
    </div>
  )
}

export default SessionPage
