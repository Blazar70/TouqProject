import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { VISIT_TYPES, visitTypeLabel } from '../lib/visitTypes'
import { parseVitals, visitRecordFields } from '../lib/clinicalFields'
import { uploadPhoto, validateImageFile } from '../lib/imageUpload'
import { usePasteImage } from '../lib/usePasteImage'
import { useDropImage } from '../lib/useDropImage'
import SpeciesSelect from './SpeciesSelect'
import TrustedContactsPanel from './TrustedContactsPanel'
import VaccinationPanel from './VaccinationPanel'
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
type MedicalRecord = Database['public']['Tables']['medical_records']['Row'] & { vet: { full_name: string } | null }
const RECORD_SELECT = '*, vet:profiles!medical_records_vet_id_fkey(full_name)'

// The edit form's fields as typed text; vitals are parsed on save.
function recordToEdit(record: MedicalRecord) {
  return {
    visitType: record.visit_type ?? '',
    complaint: record.presenting_complaint ?? '',
    weight: record.weight_kg?.toString() ?? '',
    temperature: record.temperature_c?.toString() ?? '',
    heartRate: record.heart_rate_bpm?.toString() ?? '',
    physicalExam: record.physical_exam ?? '',
    diagnosis: record.diagnosis ?? '',
    diagnosticPlan: record.diagnostic_plan ?? '',
    treatment: record.treatment ?? '',
    notes: record.notes ?? '',
    remarks: record.remarks ?? '',
  }
}
type RecordEdit = ReturnType<typeof recordToEdit>

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
  const { profile } = useAuth()
  const { branchId, branchName } = useBranch()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const { printSummary, printHistory } = usePrintSummary()
  const isVet = profile?.role === 'vet'

  const [name, setName] = useState(pet.name)
  const [species, setSpecies] = useState(pet.species)
  const [breed, setBreed] = useState(pet.breed ?? '')
  const [dateOfBirth, setDateOfBirth] = useState(pet.date_of_birth ?? '')
  const [savingPet, setSavingPet] = useState(false)
  const [petError, setPetError] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [pickingOwner, setPickingOwner] = useState(false)

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
    name !== pet.name || species !== pet.species || breed !== (pet.breed ?? '') || dateOfBirth !== (pet.date_of_birth ?? '')
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
      .update({
        visit_type: edit.visitType || null,
        presenting_complaint: edit.complaint.trim() || null,
        ...vitalsResult.vitals,
        physical_exam: edit.physicalExam.trim() || null,
        diagnosis: edit.diagnosis || null,
        diagnostic_plan: edit.diagnosticPlan.trim() || null,
        treatment: edit.treatment || null,
        notes: edit.notes || null,
        remarks: edit.remarks.trim() || null,
      })
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

  return (
    <div className="pet-detail">
      <form onSubmit={handleSavePet} className="pet-form pet-detail-sidebar">
        <h3>{t('petDetail.title')}</h3>
        <p className="pet-owner">
          {t('pets.petId')}: <Ltr>{pet.pet_number}</Ltr>
        </p>
        <FormError message={petError} />

        <div className={`pet-photo-row${dragActive ? ' pet-photo-row-drag-active' : ''}`} {...dragHandlers}>
          <PetAvatar pet={pet} size={72} />
          {isVet && (
            <div>
              <div className="pet-photo-actions">
                <label className="secondary-button pet-photo-upload">
                  {uploadingPhoto ? t('petDetail.uploading') : pet.photo_url ? t('petDetail.changePhoto') : t('petDetail.addPhoto')}
                  <input type="file" accept="image/*" onChange={handlePhotoChange} disabled={uploadingPhoto} hidden />
                </label>
              </div>
              <p className="pet-owner">{t('petDetail.pastePhotoHint')}</p>
            </div>
          )}
        </div>

        <label>
          {t('common.name')}
          <RequiredMark />
          <input value={name} onChange={(e) => setName(e.target.value)} required disabled={!isVet} />
        </label>
        <label>
          {t('registerPet.species')}
          <SpeciesSelect value={species} onChange={setSpecies} disabled={!isVet} />
        </label>
        <label>
          {t('registerPet.breed')}
          <input value={breed} onChange={(e) => setBreed(e.target.value)} disabled={!isVet} />
        </label>
        <label>
          {t('registerPet.dateOfBirth')}
          <input type="date" dir="ltr" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} disabled={!isVet} />
        </label>
        <div className="pet-detail-owner">
          <span className="pet-owner">{t('pets.owner')}</span>
          {isVet ? (
            <Link to={`/owners?id=${pet.owner_file_id}`}>
              <strong>{pet.owner_name}</strong>
            </Link>
          ) : (
            <strong>{pet.owner_name}</strong>
          )}
          {pet.owner_phone && (
            <span className="pet-owner">
              <Ltr>{pet.owner_phone}</Ltr>
            </span>
          )}
          {isVet && (
            <button type="button" className="secondary-button" onClick={() => setPickingOwner(true)}>
              {t('owners.changeOwner')}
            </button>
          )}
        </div>
        {isVet && (
          <>
            <button type="submit" disabled={savingPet}>
              {savingPet ? t('common.saving') : t('common.saveChanges')}
            </button>
            {/* Kept inside the open pet file, not on the list row, so deleting takes a deliberate extra step. */}
            <button type="button" className="delete-button" onClick={onDelete}>
              {t('common.delete')}
            </button>
          </>
        )}
      </form>
      {pickingOwner && (
        <OwnerPickerModal
          title={t('owners.moveTitle', { pet: pet.name })}
          excludeId={pet.owner_file_id}
          allowNew
          onPick={handleChangeOwner}
          onClose={() => setPickingOwner(false)}
        />
      )}

      <div className="pet-detail-main">
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
                        record,
                        photoUrl: includeHistoryPhotos ? record.photo_url : null,
                      })),
                      pet.pet_number,
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
                      {/* Notes is the pre-0040 field; only records that already have it show it. */}
                      {record.notes && (
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
                            <div key={field.labelKey}>
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
                                owner: [pet.owner_name, pet.owner_phone && `⁦${pet.owner_phone}⁩`].filter(Boolean).join(' · '),
                                record,
                                photoUrl: (includePhotoByRecord[record.id] ?? true) ? record.photo_url : null,
                              }, pet.pet_number)
                            }
                          >
                            {t('common.print')}
                          </button>
                          {isVet && (
                            <>
                              <button type="button" className="secondary-button" onClick={() => startEditingRecord(record)}>
                                {t('common.edit')}
                              </button>
                              <button type="button" className="delete-button" onClick={() => handleDeleteRecord(record)}>
                                {t('common.delete')}
                              </button>
                            </>
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

        <VaccinationPanel pet={pet} onUpdated={onUpdated} />
        <TrustedContactsPanel petId={pet.id} />
      </div>
    </div>
  )
}

export default PetDetail
