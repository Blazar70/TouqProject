import { useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import { useConfirm } from '../lib/ConfirmContext'
import { CLINIC_LOGOS_BUCKET, clinicLogoUrl, uploadPhoto, validateImageFile } from '../lib/imageUpload'
import type { Database } from '../lib/database.types'

type Clinic = Database['public']['Tables']['clinics']['Row']

// Logo preview + upload/remove. Admin Clinics page and the manager's Settings;
// storage and clinics.logo_url are guarded by can_manage_clinic_logo() (0053).
function ClinicLogoField({ clinic, onSaved }: { clinic: Pick<Clinic, 'id' | 'name' | 'logo_url'>; onSaved: (clinic: Clinic) => void }) {
  const { t } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  async function save(logoUrl: string | null) {
    const { data, error } = await supabase.from('clinics').update({ logo_url: logoUrl }).eq('id', clinic.id).select().single()
    setBusy(false)
    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      return
    }
    // Same path is overwritten in place; a different extension leaves the old file, so remove it.
    const oldPath = clinic.logo_url?.split('?')[0]
    if (oldPath && oldPath !== logoUrl?.split('?')[0]) await supabase.storage.from(CLINIC_LOGOS_BUCKET).remove([oldPath])
    onSaved(data)
    // Logged by the database (0057).
    toast.success(t(logoUrl ? 'admin.logoSaved' : 'admin.logoRemoved', { name: data.name }))
  }

  async function handleFile(file: File) {
    const invalid = validateImageFile(file)
    if (invalid) {
      toast.error(t(invalid === 'notImage' ? 'petDetail.imageOnly' : 'petDetail.imageTooLarge'))
      return
    }
    setBusy(true)
    const upload = await uploadPhoto(`${clinic.id}/logo`, file, CLINIC_LOGOS_BUCKET)
    if (upload.error !== null) {
      toast.error(upload.error)
      setBusy(false)
      return
    }
    // Cache-bust: a re-upload keeps the same path.
    await save(`${upload.path}?t=${Date.now()}`)
  }

  async function handleRemove() {
    const ok = await confirm(t('admin.removeLogoConfirm', { name: clinic.name }), {
      danger: true,
      confirmLabel: t('admin.removeLogo'),
    })
    if (!ok) return
    setBusy(true)
    await save(null)
  }

  return (
    <div className="admin-clinic-logo">
      <span className="admin-clinic-logo-preview">
        {clinic.logo_url ? (
          <img src={clinicLogoUrl(clinic.logo_url)} alt={t('admin.logoAlt', { name: clinic.name })} />
        ) : (
          <ImageIcon size={20} aria-hidden />
        )}
      </span>
      <div className="record-actions">
        <label className="secondary-button admin-file-label">
          {busy ? t('common.saving') : clinic.logo_url ? t('admin.changeLogo') : t('admin.uploadLogo')}
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) handleFile(file)
            }}
          />
        </label>
        {clinic.logo_url && (
          <button type="button" className="delete-button" onClick={handleRemove} disabled={busy}>
            {t('admin.removeLogo')}
          </button>
        )}
      </div>
    </div>
  )
}

export default ClinicLogoField
