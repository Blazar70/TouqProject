import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Timer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { VISIT_TYPES, visitTypeLabel } from '../lib/visitTypes'
import { parseVitals } from '../lib/clinicalFields'
import { uploadPhoto, validateImageFile } from '../lib/imageUpload'
import { usePasteImage } from '../lib/usePasteImage'
import { useDropImage } from '../lib/useDropImage'
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning'
import { notifyStatusChange } from '../lib/push'
import { useToast } from '../lib/ToastContext'
import LoadingScreen from '../components/LoadingScreen'
import RequiredMark from '../components/RequiredMark'
import Ltr from '../components/Ltr'

type Appointment = Database['public']['Tables']['appointments']['Row'] & {
  pets: { name: string; species: string; breed: string | null; owner_name: string; owner_phone: string | null } | null
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

function SessionPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { t } = useLanguage()
  const toast = useToast()

  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const [visitType, setVisitType] = useState('')
  const [complaint, setComplaint] = useState('')
  const [weight, setWeight] = useState('')
  const [temperature, setTemperature] = useState('')
  const [heartRate, setHeartRate] = useState('')
  const [physicalExam, setPhysicalExam] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [diagnosticPlan, setDiagnosticPlan] = useState('')
  const [treatment, setTreatment] = useState('')
  const [remarks, setRemarks] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const dirty = Boolean(
    visitType || complaint || weight || temperature || heartRate || physicalExam || diagnosis || diagnosticPlan || treatment || remarks || photoFile,
  )
  useUnsavedChangesWarning(dirty && !done)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    supabase
      .from('appointments')
      .select('*, pets(name, species, breed, owner_name, owner_phone)')
      .eq('id', id)
      .maybeSingle()
      .then(async ({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        // Opening the session starts it: in_session (with its start time) until Finish,
        // so everyone sees the pet is being worked on and the timer survives other devices.
        if (data && (data.status === 'requested' || data.status === 'confirmed')) {
          const { data: started, error: startError } = await supabase
            .from('appointments')
            .update({ status: 'in_session', started_at: new Date().toISOString() })
            .eq('id', data.id)
            .in('status', ['requested', 'confirmed'])
            .select('*, pets(name, species, breed, owner_name, owner_phone)')
            .maybeSingle()
          if (startError) setError(startError.message)
          if (started) {
            notifyStatusChange(started.id)
            data = started
          }
        }
        setAppointment(data)
        setLoading(false)
      })
  }, [id])

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!appointment) return
    setError(null)

    if (!profile?.clinic_id) {
      setError(t('appointments.onlyStaffComplete'))
      return
    }
    if (!visitType || !diagnosis || !treatment) {
      setError(t('appointments.completionRequired'))
      return
    }
    // Checked before saving anything so a typo in a vital can be fixed first.
    const vitalsResult = parseVitals({ weight, temperature, heartRate })
    if (!vitalsResult.ok) {
      setError(t(vitalsResult.errorKey))
      return
    }

    // Record first, then the status: a failed save must never leave a
    // completed appointment without its record.
    setSaving(true)
    const { data: newRecord, error: recordError } = await supabase
      .from('medical_records')
      .insert({
        pet_id: appointment.pet_id,
        clinic_id: profile.clinic_id,
        vet_id: profile.id,
        appointment_id: appointment.id,
        visit_type: visitType,
        presenting_complaint: complaint.trim() || null,
        ...vitalsResult.vitals,
        physical_exam: physicalExam.trim() || null,
        diagnosis,
        diagnostic_plan: diagnosticPlan.trim() || null,
        treatment,
        remarks: remarks.trim() || null,
      })
      .select()
      .single()
    if (recordError || !newRecord) {
      setError(t('appointments.recordFailed', { error: recordError?.message ?? '' }))
      setSaving(false)
      return
    }

    const { error: appointmentError } = await supabase
      .from('appointments')
      .update({ status: 'completed' })
      .eq('id', appointment.id)
    if (appointmentError) {
      // Undo the record so pressing Finish again doesn't save it twice.
      await supabase.from('medical_records').delete().eq('id', newRecord.id)
      setError(appointmentError.message)
      setSaving(false)
      return
    }

    // The record's already saved at this point — a photo upload failure
    // is worth surfacing but shouldn't undo the completion.
    if (photoFile) {
      const upload = await uploadPhoto(`${profile.clinic_id}/records/${newRecord.id}`, photoFile)
      if (upload.error !== null) {
        toast.error(t('common.couldNotSavePhoto'))
      } else {
        await supabase.from('medical_records').update({ photo_url: upload.path }).eq('id', newRecord.id)
      }
    }

    toast.success(t('appointments.completedToast'))
    notifyStatusChange(appointment.id)
    setDone(true)
  }

  // After the render that turns the unsaved-changes guard off, or it would block this.
  useEffect(() => {
    if (done) navigate('/appointments')
  }, [done, navigate])

  if (loading) return <LoadingScreen />

  if (!appointment || appointment.status === 'completed' || appointment.status === 'cancelled') {
    return (
      <div>
        {error && <p className="form-error">{error}</p>}
        <p>{appointment ? t('session.notActive') : t('session.notFound')}</p>
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

      {error && <p className="form-error">{error}</p>}

      <form onSubmit={handleSubmit} className="pet-form session-form">
        <label>
          {t('petDetail.visitType')}
          <RequiredMark />
          <select value={visitType} onChange={(e) => setVisitType(e.target.value)} required>
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
          {t('clinical.presentingComplaint')}
          <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={2} />
        </label>
        {/* Numbers read left-to-right even in Arabic, hence dir="ltr" on the inputs only. */}
        <div className="vitals-row">
          <label>
            {t('clinical.weightKg')}
            <input type="text" inputMode="decimal" dir="ltr" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </label>
          <label>
            {t('clinical.temperatureC')}
            <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </label>
          <label>
            {t('clinical.heartRateBpm')}
            <input type="text" inputMode="numeric" dir="ltr" value={heartRate} onChange={(e) => setHeartRate(e.target.value)} />
          </label>
        </div>
        <label>
          {t('clinical.physicalExam')}
          <textarea value={physicalExam} onChange={(e) => setPhysicalExam(e.target.value)} rows={3} />
        </label>
        <label>
          {t('petDetail.diagnosis')}
          <RequiredMark />
          <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} required />
        </label>
        <label>
          {t('clinical.diagnosticPlan')}
          <textarea value={diagnosticPlan} onChange={(e) => setDiagnosticPlan(e.target.value)} rows={2} />
        </label>
        <label>
          {t('petDetail.treatment')}
          <RequiredMark />
          <input value={treatment} onChange={(e) => setTreatment(e.target.value)} required />
        </label>
        <label>
          {t('clinical.remarks')}
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
        </label>
        <div className={`pet-photo-row${dragActive ? ' pet-photo-row-drag-active' : ''}`} {...dragHandlers}>
          {photoPreviewUrl && <img src={photoPreviewUrl} alt="" className="pet-avatar" style={{ width: 56, height: 56 }} />}
          <div>
            <div className="pet-photo-actions">
              <label className="secondary-button pet-photo-upload">
                {photoFile ? t('petDetail.changePhoto') : t('appointments.addPhotoOptional')}
                <input type="file" accept="image/*" onChange={handlePhotoChange} hidden />
              </label>
            </div>
            <p className="pet-owner">{t('petDetail.pastePhotoHint')}</p>
          </div>
        </div>
        <div className="record-edit-actions">
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? t('common.saving') : t('session.finish')}
          </button>
          <button type="button" className="cancel-button" onClick={() => navigate('/appointments')}>
            {t('session.backToAppointments')}
          </button>
        </div>
      </form>
    </div>
  )
}

export default SessionPage
