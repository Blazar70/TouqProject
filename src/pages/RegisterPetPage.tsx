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
import { handleEnterAdvance } from '../lib/formEnterNav'

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

    if (!isValidSaudiMobile(ownerPhone)) {
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
        owner_name: ownerName,
        owner_phone: `+966${ownerPhone}`,
        owner_email: ownerEmail || null,
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
        await supabase.from('pets').update({ photo_url: upload.url }).eq('id', newPet.id)
      }
    }

    toast.success(t('registerPet.registered', { name }))
    navigate('/pets')
  }

  return (
    <div>
      <h1>{t('registerPet.title')}</h1>

      <form onSubmit={handleSubmit} onKeyDown={handleEnterAdvance} className="pet-form pet-form-grid">
        {error && <p className="form-error">{error}</p>}
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
                <input type="file" accept="image/*" onChange={handlePhotoChange} hidden />
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
        <div className="record-edit-actions">
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? t('common.saving') : t('registerPet.submit')}
          </button>
          <button type="button" className="cancel-button" onClick={() => navigate('/pets')}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </div>
  )
}

export default RegisterPetPage
