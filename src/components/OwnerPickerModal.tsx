import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { isValidSaudiMobile } from '../lib/phone'
import { matchesOwner } from '../lib/owners'
import { formatMoney } from '../lib/format'
import PhoneInput from './PhoneInput'
import RequiredMark from './RequiredMark'
import Ltr from './Ltr'
import FormError from './FormError'
import Modal from './Modal'

export type PickedOwner = { id: string; name: string; phone: string | null; email: string | null; balance: number }

type Props = {
  title: string
  /** Not offered (the owner being merged into, or the pet's current owner). */
  excludeId?: string
  /** Also offer "New owner" (move a pet, register a pet). */
  allowNew?: boolean
  onPick: (owner: PickedOwner) => void
  onClose: () => void
}

// Search the clinic's owners by name or phone and pick one, or create a new one.
function OwnerPickerModal({ title, excludeId, allowNew, onPick, onClose }: Props) {
  const { profile, handlesMoney } = useAuth()
  const { t } = useLanguage()
  const [owners, setOwners] = useState<PickedOwner[] | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('owner_files')
      .select('id, name, phone, email, balance')
      .order('name')
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        setOwners(data ?? [])
      })
  }, [])


  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!profile?.clinic_id) return
    if (!isValidSaudiMobile(phone)) {
      setError(t('registerPet.invalidPhone'))
      return
    }
    setSaving(true)
    const { data, error: insertError } = await supabase
      .from('owner_files')
      .insert({ clinic_id: profile.clinic_id, name: name.trim(), phone: `+966${phone}`, email: email.trim() || null })
      .select('id, name, phone, email, balance')
      .single()
    setSaving(false)
    if (insertError || !data) {
      setError(insertError?.message ?? t('common.couldNotSave'))
      return
    }
    onPick(data)
  }

  const matches = (owners ?? []).filter((o) => o.id !== excludeId && matchesOwner(o, query)).slice(0, 20)

  return (
    <Modal onClose={onClose} labelledBy="owner-picker-title">
        <h2 id="owner-picker-title">{title}</h2>
        <FormError message={error} />
        {creating ? (
          <form onSubmit={handleCreate} className="pet-form">
            <label>
              {t('common.name')}
              <RequiredMark />
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
            <label>
              {t('registerPet.ownerPhone')}
              <RequiredMark />
              <PhoneInput value={phone} onChange={setPhone} invalidMessage={t('registerPet.invalidPhone')} required />
            </label>
            <label>
              {t('registerPet.ownerEmail')}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div className="admin-modal-actions">
              <button type="button" className="cancel-button" onClick={() => setCreating(false)}>
                {t('common.back')}
              </button>
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <input
              type="search"
              className="search-input"
              placeholder={t('owners.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t('owners.search')}
              autoFocus
            />
            {owners === null ? (
              <p className="pet-owner">{t('common.loading')}</p>
            ) : matches.length === 0 ? (
              <p className="pet-owner">{t('owners.noneMatch')}</p>
            ) : (
              <ul className="record-list owner-pick-list">
                {matches.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="record-row owner-pick-row" onClick={() => onPick(o)}>
                      <strong>{o.name}</strong>
                      <span className="pet-owner">
                        {o.phone && <Ltr>{o.phone}</Ltr>}
                        {handlesMoney && o.balance > 0 && (
                          <>
                            {' · '}
                            {t('owners.balance')} <Ltr>{formatMoney(o.balance)}</Ltr> {t('common.currency')}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="admin-modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>
                {t('common.cancel')}
              </button>
              {allowNew && (
                <button type="button" className="secondary-button" onClick={() => setCreating(true)}>
                  + {t('owners.newOwner')}
                </button>
              )}
            </div>
          </>
        )}
    </Modal>
  )
}

export default OwnerPickerModal
