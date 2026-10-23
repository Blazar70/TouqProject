import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { isValidSaudiMobile } from '../lib/phone'
import Ltr from './Ltr'
import { ListSkeleton } from './Skeleton'
import PhoneInput from './PhoneInput'
import RequiredMark from './RequiredMark'
import FormError from './FormError'

type TrustedContact = Database['public']['Tables']['pet_trusted_contacts']['Row']

function TrustedContactsPanel({ petId }: { petId: string }) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const isVet = profile?.role === 'vet'

  const [contacts, setContacts] = useState<TrustedContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  async function loadContacts() {
    setLoading(true)
    const { data, error } = await supabase
      .from('pet_trusted_contacts')
      .select('*')
      .eq('pet_id', petId)
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setContacts(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadContacts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (phone && !isValidSaudiMobile(phone)) {
      setError(t('trustedContacts.invalidPhone'))
      return
    }

    setSaving(true)
    const { error } = await supabase.from('pet_trusted_contacts').insert({
      pet_id: petId,
      name,
      phone: phone ? `+966${phone}` : null,
    })

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    toast.success(t('trustedContacts.added', { name }))
    setName('')
    setPhone('')
    setSaving(false)
    setShowForm(false)
    await loadContacts()
  }

  async function handleDelete(contact: TrustedContact) {
    const ok = await confirm(t('trustedContacts.deleteConfirm', { name: contact.name }), {
      danger: true,
      confirmLabel: t('common.delete'),
    })
    if (!ok) return
    const { error } = await supabase.from('pet_trusted_contacts').delete().eq('id', contact.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setContacts((current) => current.filter((c) => c.id !== contact.id))
    toast.success(t('trustedContacts.removed', { name: contact.name }))
  }

  return (
    <div className="trusted-contacts">
      <div className="panel-header">
        <h3>{t('trustedContacts.title')}</h3>
        {isVet && !showForm && (
          <button type="button" className="secondary-button" onClick={() => setShowForm(true)}>
            + {t('common.add')}
          </button>
        )}
      </div>
      <p className="pet-owner">{t('trustedContacts.description')}</p>

      <FormError message={error} />

      {loading ? (
        <ListSkeleton rows={2} />
      ) : contacts.length === 0 ? (
        !error && <p>{t('trustedContacts.none')}</p>
      ) : (
        <ul className="record-list">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <div className="record-row">
                <div>
                  <strong>{contact.name}</strong>
                  {contact.phone && (
                    <div className="pet-owner">
                      <Ltr>{contact.phone}</Ltr>
                    </div>
                  )}
                </div>
                {isVet && (
                  <button type="button" className="delete-button" onClick={() => handleDelete(contact)}>
                    {t('common.delete')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isVet && showForm && (
        <form onSubmit={handleAdd} className="pet-form">
          <label>
            {t('common.name')}
            <RequiredMark />
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
          <label>
            {t('common.phone')}
            <PhoneInput value={phone} onChange={setPhone} invalidMessage={t('trustedContacts.invalidPhone')} />
          </label>
          <div className="record-edit-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('trustedContacts.addContact')}
            </button>
            <button type="button" className="cancel-button" onClick={() => setShowForm(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default TrustedContactsPanel
