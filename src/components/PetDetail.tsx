import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { VISIT_TYPES, visitTypeLabel } from '../lib/visitTypes'
import { validateImageFile } from '../lib/imageUpload'
import { usePasteImage } from '../lib/usePasteImage'
import { useDropImage } from '../lib/useDropImage'
import SpeciesSelect from './SpeciesSelect'
import TrustedContactsPanel from './TrustedContactsPanel'
import VaccinationPanel from './VaccinationPanel'
import VaccinationBadge from './VaccinationBadge'
import PetAvatar from './PetAvatar'
import Ltr from './Ltr'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import { usePrintSummary } from '../lib/PrintContext'
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning'
import { ListSkeleton } from './Skeleton'
import RequiredMark from './RequiredMark'
import PhotoThumbnail from './PhotoThumbnail'
import PasteFromClipboardButton from './PasteFromClipboardButton'

type Pet = Database['public']['Tables']['pets']['Row']
type MedicalRecord = Database['public']['Tables']['medical_records']['Row']

function PetDetail({
  pet,
  onUpdated,
  onDirtyChange,
}: {
  pet: Pet
  onUpdated: (pet: Pet) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { profile } = useAuth()
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

  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [recordError, setRecordError] = useState<string | null>(null)

  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [editVisitType, setEditVisitType] = useState('')
  const [editDiagnosis, setEditDiagnosis] = useState('')
  const [editTreatment, setEditTreatment] = useState('')
  const [editNotes, setEditNotes] = useState('')
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
      .select('*')
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

      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${profile.clinic_id}/${pet.id}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('pet-photos')
        .upload(path, file, { upsert: true, contentType: file.type })

      if (uploadError) {
        setPetError(uploadError.message)
        setUploadingPhoto(false)
        return
      }

      const { data: publicUrlData } = supabase.storage.from('pet-photos').getPublicUrl(path)
      // Cache-bust so the new photo shows immediately even though the path is unchanged.
      const photoUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`

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
      const dirty =
        editingRecord &&
        (editVisitType !== (editingRecord.visit_type ?? '') ||
          editDiagnosis !== (editingRecord.diagnosis ?? '') ||
          editTreatment !== (editingRecord.treatment ?? '') ||
          editNotes !== (editingRecord.notes ?? ''))
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
    setEditVisitType(record.visit_type ?? '')
    setEditDiagnosis(record.diagnosis ?? '')
    setEditTreatment(record.treatment ?? '')
    setEditNotes(record.notes ?? '')
  }

  function toggleRecordExpanded(recordId: string) {
    setExpandedRecordId((current) => (current === recordId ? null : recordId))
  }

  async function handleSaveRecordEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingRecordId) return
    setRecordError(null)
    setSavingEdit(true)

    const { error } = await supabase
      .from('medical_records')
      .update({
        visit_type: editVisitType || null,
        diagnosis: editDiagnosis || null,
        treatment: editTreatment || null,
        notes: editNotes || null,
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
      <div className="pet-detail-topbar">
        <VaccinationBadge nextDate={pet.next_vaccination_date} />
      </div>

      <form onSubmit={handleSavePet} className="pet-form pet-detail-sidebar">
        <h3>{t('petDetail.title')}</h3>
        {petError && <p className="form-error">{petError}</p>}

        <div className={`pet-photo-row${dragActive ? ' pet-photo-row-drag-active' : ''}`} {...dragHandlers}>
          <PetAvatar pet={pet} size={72} />
          {isVet && (
            <div>
              <div className="pet-photo-actions">
                <label className="secondary-button pet-photo-upload">
                  {uploadingPhoto ? t('petDetail.uploading') : pet.photo_url ? t('petDetail.changePhoto') : t('petDetail.addPhoto')}
                  <input type="file" accept="image/*" onChange={handlePhotoChange} disabled={uploadingPhoto} hidden />
                </label>
                <PasteFromClipboardButton onFile={processPhotoFile} disabled={uploadingPhoto} />
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
        {isVet && (
          <button type="submit" disabled={savingPet}>
            {savingPet ? t('common.saving') : t('common.saveChanges')}
          </button>
        )}
      </form>

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
                        diagnosis: record.diagnosis ?? '',
                        treatment: record.treatment ?? '',
                        notes: record.notes,
                        photoUrl: includeHistoryPhotos ? record.photo_url : null,
                      })),
                    )
                  }
                >
                  {t('petDetail.printHistory')}
                </button>
              </div>
            )}
          </div>
          {recordError && <p className="form-error">{recordError}</p>}

          {loadingRecords ? (
            <ListSkeleton rows={2} />
          ) : records.length === 0 ? (
            <p>{t('petDetail.noMedicalRecords')}</p>
          ) : (
            <ul className="record-list">
              {records.map((record) =>
                editingRecordId === record.id ? (
                  <li key={record.id}>
                    <form onSubmit={handleSaveRecordEdit} className="pet-form">
                      <label>
                        {t('petDetail.visitType')}
                        <select value={editVisitType} onChange={(e) => setEditVisitType(e.target.value)}>
                          <option value="">—</option>
                          {VISIT_TYPES.map((vt) => (
                            <option key={vt} value={vt}>
                              {visitTypeLabel(t, vt)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t('petDetail.diagnosis')}
                        <input value={editDiagnosis} onChange={(e) => setEditDiagnosis(e.target.value)} />
                      </label>
                      <label>
                        {t('petDetail.treatment')}
                        <input value={editTreatment} onChange={(e) => setEditTreatment(e.target.value)} />
                      </label>
                      <label>
                        {t('common.notes')}
                        <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
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
                        <Ltr>{new Date(record.visit_date).toLocaleDateString()}</Ltr>
                        {record.visit_type && ` · ${visitTypeLabel(t, record.visit_type)}`}
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
                              <PhotoThumbnail url={record.photo_url} alt={t('petDetail.recordPhotoAlt')} size={56} />
                            </div>
                          )}
                          {record.diagnosis && (
                            <div>
                              <strong>{t('petDetail.diagnosis')}:</strong> {record.diagnosis}
                            </div>
                          )}
                          {record.treatment && (
                            <div>
                              <strong>{t('petDetail.treatment')}:</strong> {record.treatment}
                            </div>
                          )}
                          {record.notes && (
                            <div>
                              <strong>{t('common.notes')}:</strong> {record.notes}
                            </div>
                          )}
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
                                diagnosis: record.diagnosis ?? '',
                                treatment: record.treatment ?? '',
                                notes: record.notes,
                                photoUrl: (includePhotoByRecord[record.id] ?? true) ? record.photo_url : null,
                              })
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
