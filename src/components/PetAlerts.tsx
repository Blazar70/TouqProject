import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import FormError from './FormError'

type Pet = Database['public']['Tables']['pets']['Row']

// Read-only form of the alert, for lists and pop-ups. The icon keeps it from being colour-only.
export function PetAlertLine({ alerts }: { alerts: string | null | undefined }) {
  const { t } = useLanguage()
  if (!alerts) return null
  return (
    <p className="pet-alert" role="note">
      <TriangleAlert size={18} aria-hidden />
      <span>
        <strong>{t('alerts.title')}:</strong> <bdi>{alerts}</bdi>
      </span>
    </p>
  )
}

// The small form, on dashboard rows.
export function PetAlertChip({ alerts }: { alerts: string | null | undefined }) {
  const { t } = useLanguage()
  if (!alerts) return null
  return (
    <span className="pet-alert-chip" role="img" title={alerts} aria-label={`${t('alerts.title')}: ${alerts}`}>
      <TriangleAlert size={14} aria-hidden />
    </span>
  )
}

// H66: allergies, "bites", chronic illness, in red at the top of the pet file and the session. Any clinic role edits it (0104).
function PetAlerts({ petId, alerts, onSaved }: { petId: string; alerts: string | null; onSaved: (pet: Pet) => void }) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = Boolean(profile?.clinic_role)

  function startEditing() {
    setText(alerts ?? '')
    setError(null)
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError(null)
    const { data, error: saveError } = await supabase.from('pets').update({ alerts: text.trim() || null }).eq('id', petId).select().single()
    setSaving(false)
    if (saveError || !data) {
      setError(saveError?.message ?? t('common.couldNotSave'))
      return
    }
    onSaved(data)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="pet-alert-edit">
        <FormError message={error} />
        <label>
          {t('alerts.title')}
          <textarea dir="auto" value={text} maxLength={500} rows={2} autoFocus onChange={(e) => setText(e.target.value)} />
          <span className="pet-owner">{t('alerts.hint')}</span>
        </label>
        <div className="record-edit-actions">
          <button type="button" className="primary-button" onClick={save} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
          <button type="button" className="cancel-button" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    )
  }

  if (!alerts) {
    return canEdit ? (
      <button type="button" className="secondary-button pet-alert-add" onClick={startEditing}>
        {t('alerts.add')}
      </button>
    ) : null
  }
  return (
    <div className="pet-alert-row">
      <PetAlertLine alerts={alerts} />
      {canEdit && (
        <button type="button" className="secondary-button" onClick={startEditing}>
          {t('common.edit')}
        </button>
      )}
    </div>
  )
}

export default PetAlerts
