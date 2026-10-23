import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import { isValidSaudiMobile } from '../lib/phone'
import { uploadPhoto, validateImageFile } from '../lib/imageUpload'
import { usePasteImage } from '../lib/usePasteImage'
import { useDropImage } from '../lib/useDropImage'
import SpeciesSelect from '../components/SpeciesSelect'
import PhoneInput from '../components/PhoneInput'
import RequiredMark from '../components/RequiredMark'
import OwnerPickerModal from '../components/OwnerPickerModal'
import type { PickedOwner } from '../components/OwnerPickerModal'
import Ltr from '../components/Ltr'
import { handleEnterAdvance } from '../lib/formEnterNav'
import FormError from '../components/FormError'

function RegisterPetPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const toast = useToast()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [species, setSpecies] = useState('')
  const [breed, setBreed] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerPhone, setOwnerPhone] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  // An existing owner file (0063), or null = a new owner from the fields below.
  const [owner, setOwner] = useState<PickedOwner | null>(null)
  const [pickingOwner, setPickingOwner] = useState(false)
  const [phoneMatch, setPhoneMatch] = useState<PickedOwner | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The pet doesn't exist yet (no id to key the storage path on) until the
  // insert below succeeds, so this only ever holds a local blob preview —
  // the actual upload happens after that insert returns an id.
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
    }
  }, [photoPreviewUrl])

  const processPhotoFile = useCallback(
    (file: File) => {
      const validationError = validateImageFile(file)
      if (validationError) {
        setError(validationError === 'notImage' ? t('petDetail.imageOnly') : t('petDetail.imageTooLarge'))
        return
      }

      setError(null)
      setPhotoPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return URL.createObjectURL(file)
      })
      setPhotoFile(file)
    },
    [t],
  )

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) processPhotoFile(file)
  }

  // A typed phone that an owner already has: offer that owner instead of a duplicate.
  useEffect(() => {
    if (owner || !isValidSaudiMobile(ownerPhone)) {
      setPhoneMatch(null)
      return
    }
    supabase
      .from('owner_files')
      .select('id, name, phone, email, balance')
      .eq('phone', `+966${ownerPhone}`)
      .limit(1)
      .then(({ data }) => setPhoneMatch(data?.[0] ?? null))
  }, [owner, ownerPhone])

  // Pasting a screenshot/copied image (Ctrl+V) works the same as picking a
  // file — no need to click into anything first, this page has nothing else
  // a paste would meaningfully target.
  usePasteImage(processPhotoFile)
  const { dragActive, dragHandlers } = useDropImage(processPhotoFile)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!profile || profile.role !== 'vet' || !profile.clinic_id) {
      setError(t('registerPet.onlyStaff'))
      return
    }

    if (!species) {
      setError(t('registerPet.chooseSpecies'))
      return
    }

    if (!owner && !isValidSaudiMobile(ownerPhone)) {
      setError(t('registerPet.invalidPhone'))
      return
    }

    setSubmitting(true)
    const { data: newPet, error } = await supabase
      .from('pets')
      .insert({
        clinic_id: profile.clinic_id,
        name,
        species,
        breed: breed || null,
        date_of_birth: dateOfBirth || null,
        // With an owner file the database copies its contact onto the pet; without one it makes a file from these.
        ...(owner
          ? { owner_file_id: owner.id, owner_name: owner.name }
          : { owner_name: ownerName, owner_phone: `+966${ownerPhone}`, owner_email: ownerEmail || null }),
      })
      .select()
      .single()

    if (error || !newPet) {
      setError(error?.message ?? t('common.couldNotSave'))
      setSubmitting(false)
      return
    }

    // The pet's already registered at this point — a photo upload failure
    // is worth surfacing but shouldn't undo that or block navigating on.
    if (photoFile) {
      const upload = await uploadPhoto(`${profile.clinic_id}/${newPet.id}`, photoFile)
      if (upload.error !== null) {
        toast.error(t('common.couldNotSavePhoto'))
      } else {
        await supabase.from('pets').update({ photo_url: upload.path }).eq('id', newPet.id)
      }
    }

    toast.success(t('registerPet.registered', { name }))
    navigate('/pets')
  }

  return (
    <div>
      <h1>{t('registerPet.title')}</h1>

      <form onSubmit={handleSubmit} onKeyDown={handleEnterAdvance} className="pet-form pet-form-grid">
        <FormError message={error} />
        <div className={`pet-photo-row${dragActive ? ' pet-photo-row-drag-active' : ''}`} {...dragHandlers}>
          {photoPreviewUrl ? (
            <img src={photoPreviewUrl} alt="" className="pet-avatar" style={{ width: 72, height: 72 }} />
          ) : (
            <span className="pet-avatar pet-avatar-fallback" style={{ width: 72, height: 72 }} />
          )}
          <div>
            <div className="pet-photo-actions">
              <label className="secondary-button pet-photo-upload">
                {photoFile ? t('petDetail.changePhoto') : t('petDetail.addPhoto')}
                <input type="file" accept="image/*" onChange={handlePhotoChange} />
              </label>
            </div>
            <p className="pet-owner">{t('petDetail.pastePhotoHint')}</p>
          </div>
        </div>
        <label>
          {t('common.name')}
          <RequiredMark />
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t('registerPet.species')}
          <RequiredMark />
          <SpeciesSelect value={species} onChange={setSpecies} />
        </label>
        <label>
          {t('registerPet.breed')}
          <input value={breed} onChange={(e) => setBreed(e.target.value)} />
        </label>
        <label>
          {t('registerPet.dateOfBirth')}
          <input type="date" dir="ltr" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
        </label>
        {owner ? (
          <div className="owner-chosen">
            <span>
              <strong>{owner.name}</strong>
              <span className="pet-owner">{owner.phone && <Ltr>{owner.phone}</Ltr>}</span>
            </span>
            <button type="button" className="secondary-button" onClick={() => setOwner(null)}>
              {t('owners.newOwner')}
            </button>
          </div>
        ) : (
          <>
            <div className="owner-pick-bar">
              <button type="button" className="secondary-button" onClick={() => setPickingOwner(true)}>
                {t('owners.pickExisting')}
              </button>
            </div>
            <label>
              {t('registerPet.ownerName')}
              <RequiredMark />
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
            </label>
            <label>
              {t('registerPet.ownerPhone')}
              <RequiredMark />
              <PhoneInput value={ownerPhone} onChange={setOwnerPhone} invalidMessage={t('registerPet.invalidPhone')} required />
            </label>
            <label>
              {t('registerPet.ownerEmail')}
              <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
            </label>
            {phoneMatch && (
              <div className="owner-chosen">
                <span>{t('owners.phoneMatch', { name: phoneMatch.name })}</span>
                <button type="button" className="secondary-button" onClick={() => setOwner(phoneMatch)}>
                  {t('owners.useThisOwner')}
                </button>
              </div>
            )}
          </>
        )}
        <div className="record-edit-actions">
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? t('common.saving') : t('registerPet.submit')}
          </button>
          <button type="button" className="cancel-button" onClick={() => navigate('/pets')}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
      {pickingOwner && (
        <OwnerPickerModal
          title={t('owners.pickExisting')}
          onPick={(picked) => {
            setOwner(picked)
            setPickingOwner(false)
          }}
          onClose={() => setPickingOwner(false)}
        />
      )}
    </div>
  )
}

export default RegisterPetPage
