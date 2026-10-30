import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { MICROCHIP_PATTERN, cleanMicrochip } from '../lib/microchip'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { VISIT_TYPES, visitTypeLabel } from '../lib/visitTypes'
import { editToRecord, isDoctorOnlyField, parseVitals, recordToEdit, toPrescription, visitRecordFields } from '../lib/clinicalFields'
import type { RecordColumns, RecordEdit } from '../lib/clinicalFields'
import { uploadPhoto, validateImageFile } from '../lib/imageUpload'
import { usePasteImage } from '../lib/usePasteImage'
import { useDropImage } from '../lib/useDropImage'
import SpeciesSelect from './SpeciesSelect'
import TrustedContactsPanel from './TrustedContactsPanel'
import VaccinationPanel from './VaccinationPanel'
import WeightChart from './WeightChart'
import PrescriptionEditor from './PrescriptionEditor'
import InpatientPanel from './InpatientPanel'
import type { OpenStay } from './InpatientPanel'
import VaccinationBadge from './VaccinationBadge'
import { speciesLabel } from '../lib/species'
import { stayDay } from '../lib/inpatient'
import WaiversPanel from './WaiversPanel'
import PetAvatar from './PetAvatar'
import Ltr from './Ltr'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import { usePrintSummary } from '../lib/PrintContext'
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning'
import { ListSkeleton } from './Skeleton'
import RequiredMark from './RequiredMark'
import PhotoThumbnail from './PhotoThumbnail'
import OwnerPickerModal from './OwnerPickerModal'
import type { PickedOwner } from './OwnerPickerModal'
import { formatDate } from '../lib/format'
import FormError from './FormError'

type Pet = Database['public']['Tables']['pets']['Row']
type MedicalRecord = Database['public']['Tables']['medical_records']['Row'] & { vet: { full_name: string } | null; nurse: { full_name: string } | null }
const RECORD_SELECT = '*, vet:profiles!medical_records_vet_id_fkey(full_name), nurse:profiles!medical_records_nurse_id_fkey(full_name)'


function PetDetail({
  pet,
  onUpdated,
  onDirtyChange,
  onDelete,
}: {
  pet: Pet
  onUpdated: (pet: Pet) => void
  onDirtyChange?: (dirty: boolean) => void
  onDelete: () => void
}) {
  const { profile, handlesMoney } = useAuth()
  const { branchId, branchName, canWriteAt } = useBranch()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const { printSummary, printHistory, printPrescription } = usePrintSummary()
  const isVet = profile?.role === 'vet'
  const isNurse = profile?.clinic_role === 'nurse'
  // Visit records are written by clinicians only (0087); reception reads them.
  const isClinician = ['doctor', 'nurse', 'manager'].includes(profile?.clinic_role ?? '')

  const [name, setName] = useState(pet.name)
  const [species, setSpecies] = useState(pet.species)
  const [breed, setBreed] = useState(pet.breed ?? '')
  const [microchip, setMicrochip] = useState(pet.microchip ?? '')
  const [dateOfBirth, setDateOfBirth] = useState(pet.date_of_birth ?? '')
  const [savingPet, setSavingPet] = useState(false)
  const [petError, setPetError] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [pickingOwner, setPickingOwner] = useState(false)
  const [editingDetails, setEditingDetails] = useState(false)
  const [stay, setStay] = useState<OpenStay | null>(null)

  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [recordError, setRecordError] = useState<string | null>(null)

  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [edit, setEdit] = useState<RecordEdit | null>(null)
  const setEditField = (field: keyof RecordEdit, value: string) => setEdit((e) => (e ? { ...e, [field]: value } : e))
  const [savingEdit, setSavingEdit] = useState(false)

  // Defaults to checked whenever a record has a photo — per-record for the
  // single print button, one shared toggle for "print full history" since
  // asking per-visit there would be a checkbox for every entry in the batch.
  const [includePhotoByRecord, setIncludePhotoByRecord] = useState<Record<string, boolean>>({})
  const [includeHistoryPhotos, setIncludeHistoryPhotos] = useState(true)

  const petFormDirty =
    name !== pet.name || species !== pet.species || breed !== (pet.breed ?? '') || microchip !== (pet.microchip ?? '') || dateOfBirth !== (pet.date_of_birth ?? '')
  const isDirty = petFormDirty || editingRecordId !== null
  useUnsavedChangesWarning(isDirty)

  useEffect(() => {
    onDirtyChange?.(isDirty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty])

  // The parent list swaps which pet's PetDetail is mounted based on local
  // state (expandedPetId), not a route change — so on unmount (switching
  // away, e.g. to a different pet), tell the parent this one's no longer
  // the dirty one in play.
  useEffect(() => {
    return () => onDirtyChange?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadRecords() {
    setLoadingRecords(true)
    const { data, error } = await supabase
      .from('medical_records')
      .select(RECORD_SELECT)
      .eq('pet_id', pet.id)
      .order('visit_date', { ascending: false })
    if (error) setRecordError(error.message)
    else setRecords(data ?? [])
    setLoadingRecords(false)
  }

  useEffect(() => {
    loadRecords()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet.id])

  async function handleSavePet(e: FormEvent) {
    e.preventDefault()
    setPetError(null)

    if (!species) {
      setPetError(t('petDetail.chooseSpecies'))
      return
    }

    setSavingPet(true)

    const { data, error } = await supabase
      .from('pets')
      .update({
        name,
        species,
        breed: breed || null,
        microchip: microchip || null,
        date_of_birth: dateOfBirth || null,
      })
      .eq('id', pet.id)
      .select()
      .single()

    if (error || !data) {
      setPetError(error?.message ?? t('common.couldNotSave'))
      setSavingPet(false)
      return
    }

    onUpdated(data)
    setSavingPet(false)
    setEditingDetails(false)
    toast.success(t('petDetail.petSaved', { name: data.name }))
  }

  // Moves the pet to another owner file; the database copies that owner's contact onto the pet (0063).
  async function handleChangeOwner(owner: PickedOwner) {
    setPickingOwner(false)
    const { data, error } = await supabase.from('pets').update({ owner_file_id: owner.id }).eq('id', pet.id).select().single()
    if (error || !data) {
      setPetError(error?.message ?? t('common.couldNotSave'))
      return
    }
    onUpdated(data)
    toast.success(t('owners.moved', { pet: data.name, name: owner.name }))
  }

  const processPhotoFile = useCallback(
    async (file: File) => {
      if (!profile?.clinic_id) return

      const validationError = validateImageFile(file)
      if (validationError) {
        setPetError(validationError === 'notImage' ? t('petDetail.imageOnly') : t('petDetail.imageTooLarge'))
        return
      }

      setPetError(null)
      setUploadingPhoto(true)

      const upload = await uploadPhoto(`${profile.clinic_id}/${pet.id}`, file)

      if (upload.error !== null) {
        setPetError(upload.error)
        setUploadingPhoto(false)
        return
      }

      // Cache-bust so the new photo shows immediately even though the path is unchanged.
      const photoUrl = `${upload.path}?t=${Date.now()}`

      const { data, error } = await supabase
        .from('pets')
        .update({ photo_url: photoUrl })
        .eq('id', pet.id)
        .select()
        .single()

      if (error || !data) {
        setPetError(error?.message ?? t('common.couldNotSavePhoto'))
        setUploadingPhoto(false)
        return
      }

      onUpdated(data)
      setUploadingPhoto(false)
      toast.success(t('petDetail.photoSaved'))
    },
    [profile?.clinic_id, pet.id, t, toast, onUpdated],
  )

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) processPhotoFile(file)
  }

  // Pasting a screenshot/copied image (Ctrl+V) works the same as picking a
  // file — only while this pet's own edit form is on screen and the viewer
  // can actually change the photo (owners can't).
  usePasteImage(processPhotoFile, isVet)
  const { dragActive, dragHandlers } = useDropImage(processPhotoFile, isVet)

  async function startEditingRecord(record: MedicalRecord) {
    // Switching which record's edit form is open swaps the form fields in
    // place — no unmount, no navigation, so neither useBlocker nor the
    // parent's dirty tracking sees this happen. Guard it here directly.
    if (editingRecordId && editingRecordId !== record.id) {
      const editingRecord = records.find((r) => r.id === editingRecordId)
      const original = editingRecord && recordToEdit(editingRecord)
      const dirty = original && edit && (Object.keys(original) as (keyof RecordEdit)[]).some((k) => edit[k] !== original[k])
      if (dirty) {
        const leave = await confirm(t('common.unsavedChangesConfirm'), {
          confirmLabel: t('common.leaveWithoutSaving'),
          cancelLabel: t('common.stay'),
        })
        if (!leave) return
      }
    }

    setEditingRecordId(record.id)
    setExpandedRecordId(record.id)
    setEdit(recordToEdit(record))
  }

  function toggleRecordExpanded(recordId: string) {
    setExpandedRecordId((current) => (current === recordId ? null : recordId))
  }

  async function handleSaveRecordEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingRecordId || !edit) return
    setRecordError(null)
    const vitalsResult = parseVitals(edit)
    if (!vitalsResult.ok) {
      setRecordError(t(vitalsResult.errorKey))
      return
    }
    setSavingEdit(true)

    const { error } = await supabase
      .from('medical_records')
      .update(
        Object.fromEntries(Object.entries(editToRecord(edit, vitalsResult.vitals)).filter(([column]) => !(isNurse && isDoctorOnlyField(column)))) as RecordColumns,
      )
      .eq('id', editingRecordId)

    if (error) {
      setRecordError(error.message)
      setSavingEdit(false)
      return
    }

    setEditingRecordId(null)
    setSavingEdit(false)
    toast.success(t('petDetail.recordSaved'))
    await loadRecords()
  }

  async function handleDeleteRecord(record: MedicalRecord) {
    const ok = await confirm(t('petDetail.deleteRecordConfirm'), { danger: true, confirmLabel: t('common.delete') })
    if (!ok) return

    const { error } = await supabase.from('medical_records').delete().eq('id', record.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setRecords((current) => current.filter((r) => r.id !== record.id))
    setExpandedRecordId((current) => (current === record.id ? null : current))
    toast.success(t('petDetail.recordDeleted'))
  }

  function cancelEditingDetails() {
    setName(pet.name)
    setSpecies(pet.species)
    setBreed(pet.breed ?? '')
    setMicrochip(pet.microchip ?? '')
    setDateOfBirth(pet.date_of_birth ?? '')
    setPetError(null)
    setEditingDetails(false)
  }

  return (
    <div className="pet-file">
      {/* Who this is and what is going on, then the two things people open a file to do. Drop a photo anywhere here. */}
      <header className={`pet-file-header${dragActive ? ' pet-photo-row-drag-active' : ''}`} {...dragHandlers}>
        <PetAvatar pet={pet} size={72} />
        <div className="pet-file-identity">
          <h1>{pet.name}</h1>
          <p className="pet-file-meta">
            {[speciesLabel(t, pet.species), pet.breed].filter(Boolean).join(' · ')} · {t('pets.petId')} <Ltr>{pet.pet_number}</Ltr>
          </p>
          <p className="pet-file-owner">
            {isVet ? <Link to={`/owners?id=${pet.owner_file_id}`}>{pet.owner_name}</Link> : pet.owner_name}
            {pet.owner_phone && (
              <span className="pet-file-meta">
                {' · '}
                <Ltr>{pet.owner_phone}</Ltr>
              </span>
            )}
          </p>
          {(stay || pet.next_vaccination_date) && (
            <div className="pet-file-chips">
              {stay && (
                <a href="#pet-inpatient" className="status-badge pet-file-stay-chip">
                  {t('inpatient.title')} · {t('inpatient.day', { count: String(stayDay(stay.admitted_at)) })} · {branchName(stay.branch_id)}
                </a>
              )}
              {pet.next_vaccination_date && <VaccinationBadge nextDate={pet.next_vaccination_date} />}
            </div>
          )}
        </div>
        {isVet && (
          <div className="pet-file-actions">
            <Link to={`/appointments?pet=${pet.id}`} className="primary-button">
              {t('appointments.newAppointment')}
            </Link>
            {handlesMoney && (
              <Link to={`/payments?pet=${pet.id}`} className="secondary-button">
                {t('petDetail.takePayment')}
              </Link>
            )}
          </div>
        )}
      </header>

      <div className="pet-file-body">
      <div className="pet-file-main">
        <div className="medical-records">
          <div className="panel-header">
            <h3>{t('petDetail.medicalRecords')}</h3>
            {records.length > 0 && (
              <div className="page-header-actions">
                {records.some((r) => r.photo_url) && (
                  <label className="include-photo-toggle">
                    <input
                      type="checkbox"
                      checked={includeHistoryPhotos}
                      onChange={(e) => setIncludeHistoryPhotos(e.target.checked)}
                    />
                    {t('petDetail.includePhotos')}
                  </label>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    printHistory(
                      pet.name,
                      records.map((record) => ({
                        date: record.visit_date,
                        visitType: record.visit_type ? visitTypeLabel(t, record.visit_type) : undefined,
                        doctor: record.vet?.full_name,
                        nurse: record.nurse?.full_name,
                        record,
                        photoUrl: includeHistoryPhotos ? record.photo_url : null,
                      })),
                      pet,
                    )
                  }
                >
                  {t('petDetail.printHistory')}
                </button>
              </div>
            )}
          </div>
          <FormError message={recordError} />

          {loadingRecords ? (
            <ListSkeleton rows={2} />
          ) : records.length === 0 ? (
            <p>{t('petDetail.noMedicalRecords')}</p>
          ) : (
            <ul className="record-list">
              {records.map((record) =>
                editingRecordId === record.id && edit ? (
                  <li key={record.id}>
                    <form onSubmit={handleSaveRecordEdit} className="pet-form">
                      <label>
                        {t('petDetail.visitType')}
                        <select value={edit.visitType} onChange={(e) => setEditField('visitType', e.target.value)}>
                          <option value="">—</option>
                          {VISIT_TYPES.map((vt) => (
                            <option key={vt} value={vt}>
                              {visitTypeLabel(t, vt)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t('clinical.presentingComplaint')}
                        <textarea value={edit.complaint} onChange={(e) => setEditField('complaint', e.target.value)} rows={2} />
                      </label>
                      {/* Numbers read left-to-right even in Arabic, hence dir="ltr" on the inputs only. */}
                      <div className="vitals-row">
                        <label>
                          {t('clinical.weightKg')}
                          <input
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={edit.weight}
                            onChange={(e) => setEditField('weight', e.target.value)}
                          />
                        </label>
                        <label>
                          {t('clinical.temperatureC')}
                          <input
                            type="text"
                            inputMode="decimal"
                            dir="ltr"
                            value={edit.temperature}
                            onChange={(e) => setEditField('temperature', e.target.value)}
                          />
                        </label>
                        <label>
                          {t('clinical.heartRateBpm')}
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            value={edit.heartRate}
                            onChange={(e) => setEditField('heartRate', e.target.value)}
                          />
                        </label>
                      </div>
                      <label>
                        {t('clinical.physicalExam')}
                        <textarea value={edit.physicalExam} onChange={(e) => setEditField('physicalExam', e.target.value)} rows={3} />
                      </label>
                      {/* Diagnosis, plan and treatment are the doctor's (0075). */}
                      {!isNurse && (
                        <>
                          <label>
                            {t('petDetail.diagnosis')}
                            <input value={edit.diagnosis} onChange={(e) => setEditField('diagnosis', e.target.value)} />
                          </label>
                          <label>
                            {t('clinical.diagnosticPlan')}
                            <textarea
                              value={edit.diagnosticPlan}
                              onChange={(e) => setEditField('diagnosticPlan', e.target.value)}
                              rows={2}
                            />
                          </label>
                          <label>
                            {t('petDetail.treatment')}
                            <input value={edit.treatment} onChange={(e) => setEditField('treatment', e.target.value)} />
                          </label>
                          <PrescriptionEditor lines={edit.prescription} onChange={(lines) => setEdit((e) => (e ? { ...e, prescription: lines } : e))} />
                        </>
                      )}
                      {/* Notes is the pre-0040 field; only records that already have it show it. */}
                      {record.notes && !isNurse && (
                        <label>
                          {t('common.notes')}
                          <textarea value={edit.notes} onChange={(e) => setEditField('notes', e.target.value)} rows={3} />
                        </label>
                      )}
                      <label>
                        {t('clinical.remarks')}
                        <textarea value={edit.remarks} onChange={(e) => setEditField('remarks', e.target.value)} rows={2} />
                      </label>
                      <div className="record-edit-actions">
                        <button type="submit" disabled={savingEdit}>
                          {savingEdit ? t('common.saving') : t('common.save')}
                        </button>
                        <button type="button" className="cancel-button" onClick={() => setEditingRecordId(null)}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={record.id} className="record-accordion-item">
                    <button
                      type="button"
                      className="record-accordion-header"
                      onClick={() => toggleRecordExpanded(record.id)}
                      aria-expanded={expandedRecordId === record.id}
                    >
                      <span className="record-date">
                        <Ltr>{formatDate(record.visit_date)}</Ltr>
                        {record.visit_type && ` · ${visitTypeLabel(t, record.visit_type)}`}
                        {record.branch_id && record.branch_id !== branchId && branchName(record.branch_id) && (
                          <span className="pet-owner"> · {t('branch.seenAt', { name: branchName(record.branch_id) })}</span>
                        )}
                      </span>
                      <ChevronDown
                        size={18}
                        aria-hidden
                        className={`record-accordion-chevron${expandedRecordId === record.id ? ' record-accordion-chevron-open' : ''}`}
                      />
                    </button>
                    {expandedRecordId === record.id && (
                      <div className="record-row record-accordion-body">
                        <div>
                          {record.photo_url && (
                            <div className="record-photo">
                              <PhotoThumbnail path={record.photo_url} alt={t('petDetail.recordPhotoAlt')} size={56} />
                            </div>
                          )}
                          {visitRecordFields(record).map((field) => (
                            <div key={field.labelKey} className="record-field">
                              <strong>{t(field.labelKey)}:</strong> {field.value}
                            </div>
                          ))}
                        </div>
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
                              printSummary(pet.name, {
                                date: record.visit_date,
                                visitType: record.visit_type ? visitTypeLabel(t, record.visit_type) : undefined,
                                doctor: record.vet?.full_name,
                                nurse: record.nurse?.full_name,
                                owner: [pet.owner_name, pet.owner_phone && `⁦${pet.owner_phone}⁩`].filter(Boolean).join(' · '),
                                record,
                                photoUrl: (includePhotoByRecord[record.id] ?? true) ? record.photo_url : null,
                              }, pet)
                            }
                          >
                            {t('common.print')}
                          </button>
                          {toPrescription(record.prescription).length > 0 && (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                printPrescription(pet.name, {
                                  date: record.visit_date,
                                  doctor: record.vet?.full_name,
                                  owner: [pet.owner_name, pet.owner_phone && `⁦${pet.owner_phone}⁩`].filter(Boolean).join(' · '),
                                  record,
                                }, pet)
                              }
                            >
                              {t('prescription.print')}
                            </button>
                          )}
                          {/* A nurse edits her own or nurse-only records, never deletes (0075); records seen at a branch you don't work at are read-only (0076). */}
                          {isClinician && canWriteAt(record.branch_id) && (!isNurse || !record.vet_id || record.vet_id === profile?.id) && (
                            <button type="button" className="secondary-button" onClick={() => startEditingRecord(record)}>
                              {t('common.edit')}
                            </button>
                          )}
                          {isClinician && !isNurse && canWriteAt(record.branch_id) && (
                            <button type="button" className="delete-button" onClick={() => handleDeleteRecord(record)}>
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>

        <InpatientPanel pet={pet} onOpenStayChange={setStay} />
      </div>

      <aside className="pet-file-side">
        <VaccinationPanel pet={pet} onUpdated={onUpdated} />
        {isClinician && <WeightChart petId={pet.id} dateOfBirth={pet.date_of_birth} />}
        <WaiversPanel pet={pet} />
        <TrustedContactsPanel petId={pet.id} />

        <section className="pet-file-details">
          <div className="panel-header">
            <h3>{t('petDetail.title')}</h3>
            {isVet && !editingDetails && (
              <button type="button" className="secondary-button" onClick={() => setEditingDetails(true)}>
                {t('common.edit')}
              </button>
            )}
          </div>
          {editingDetails ? (
            <form onSubmit={handleSavePet} className="pet-form">
              <FormError message={petError} />
              <div className="pet-photo-actions">
                <label className="secondary-button pet-photo-upload">
                  {uploadingPhoto ? t('petDetail.uploading') : pet.photo_url ? t('petDetail.changePhoto') : t('petDetail.addPhoto')}
                  <input type="file" accept="image/*" onChange={handlePhotoChange} disabled={uploadingPhoto} />
                </label>
              </div>
              <p className="pet-owner">{t('petDetail.pastePhotoHint')}</p>
              <label>
                {t('common.name')}
                <RequiredMark />
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>
                {t('registerPet.species')}
                <SpeciesSelect value={species} onChange={setSpecies} />
              </label>
              <label>
                {t('registerPet.breed')}
                <input value={breed} onChange={(e) => setBreed(e.target.value)} />
              </label>
              <label>
                {t('pets.microchip')}
                <input
                  dir="ltr"
                  value={microchip}
                  onChange={(e) => setMicrochip(cleanMicrochip(e.target.value))}
                  pattern={MICROCHIP_PATTERN}
                  title={t('pets.microchipHint')}
                  autoComplete="off"
                />
                <span className="pet-owner">{t('pets.microchipHint')}</span>
              </label>
              <label>
                {t('registerPet.dateOfBirth')}
                <input type="date" dir="ltr" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
              </label>
              <div className="record-edit-actions">
                <button type="submit" disabled={savingPet}>
                  {savingPet ? t('common.saving') : t('common.saveChanges')}
                </button>
                <button type="button" className="cancel-button" onClick={cancelEditingDetails}>
                  {t('common.cancel')}
                </button>
              </div>
              {/* Only inside the edit form, so deleting takes a deliberate extra step. Nurses can't delete (0075). */}
              {!isNurse && (
                <button type="button" className="delete-button pet-file-delete" onClick={onDelete}>
                  {t('petDetail.deletePet')}
                </button>
              )}
            </form>
          ) : (
            <>
              <FormError message={petError} />
              <dl className="pet-facts">
                <dt>{t('registerPet.species')}</dt>
                <dd>{speciesLabel(t, pet.species)}</dd>
                <dt>{t('registerPet.breed')}</dt>
                <dd>{pet.breed || '—'}</dd>
                <dt>{t('pets.microchip')}</dt>
                <dd>{pet.microchip ? <Ltr>{pet.microchip}</Ltr> : '—'}</dd>
                <dt>{t('registerPet.dateOfBirth')}</dt>
                <dd>{pet.date_of_birth ? <Ltr>{formatDate(pet.date_of_birth)}</Ltr> : '—'}</dd>
                <dt>{t('pets.owner')}</dt>
                <dd>
                  {pet.owner_name}
                  {handlesMoney && (
                    <button type="button" className="secondary-button" onClick={() => setPickingOwner(true)}>
                      {t('owners.changeOwner')}
                    </button>
                  )}
                </dd>
              </dl>
            </>
          )}
        </section>
      </aside>
      </div>

      {pickingOwner && (
        <OwnerPickerModal
          title={t('owners.moveTitle', { pet: pet.name })}
          excludeId={pet.owner_file_id}
          allowNew
          onPick={handleChangeOwner}
          onClose={() => setPickingOwner(false)}
        />
      )}
    </div>
  )
}

export default PetDetail
