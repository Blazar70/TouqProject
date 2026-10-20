import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { isValidSaudiMobile, stripSaudiPrefix } from '../lib/phone'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import StaffAppointments from '../components/StaffAppointments'
import PhoneInput from '../components/PhoneInput'
import RefreshButton from '../components/RefreshButton'
import RequiredMark from '../components/RequiredMark'
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning'
import { formatDate } from '../lib/format'

type Caregiver = Database['public']['Tables']['caregivers']['Row']

const TRASH_RETENTION_DAYS = 7

function StaffPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const isVet = profile?.role === 'vet'

  const [staff, setStaff] = useState<Caregiver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [trashModalOpen, setTrashModalOpen] = useState(false)
  const [trashedStaff, setTrashedStaff] = useState<Caregiver[]>([])
  const [loadingTrash, setLoadingTrash] = useState(false)
  const [restoringStaffId, setRestoringStaffId] = useState<string | null>(null)
  const [purgingStaffId, setPurgingStaffId] = useState<string | null>(null)

  useUnsavedChangesWarning(Boolean(name || title || phone) || editingId !== null)

  async function loadStaff() {
    setLoading(true)
    const { data, error } = await supabase
      .from('caregivers')
      .select('*')
      .is('deleted_at', null)
      .order('name', { ascending: true })
    if (error) setError(error.message)
    else setStaff(data ?? [])
    setLoading(false)
  }

  // Re-fetches without the full-page LoadingScreen (which would collapse an
  // expanded staff member's appointments panel) — for catching up on
  // changes another staff member made while this tab sat open.
  async function handleRefresh() {
    setRefreshing(true)
    const { data, error } = await supabase
      .from('caregivers')
      .select('*')
      .is('deleted_at', null)
      .order('name', { ascending: true })
    if (error) setError(error.message)
    else setStaff(data ?? [])
    setRefreshing(false)
  }

  useEffect(() => {
    loadStaff()
  }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!profile?.clinic_id) {
      setError(t('staff.onlyManage'))
      return
    }
    if (!isValidSaudiMobile(phone)) {
      setError(t('registerPet.invalidPhone'))
      return
    }

    setSaving(true)
    const { error } = await supabase.from('caregivers').insert({
      clinic_id: profile.clinic_id,
      name,
      title: title || null,
      phone: `+966${phone}`,
    })

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    toast.success(t('staff.added', { name }))
    setName('')
    setTitle('')
    setPhone('')
    setSaving(false)
    await loadStaff()
  }

  function startEditing(member: Caregiver) {
    setEditingId(member.id)
    setEditName(member.name)
    setEditTitle(member.title ?? '')
    setEditPhone(stripSaudiPrefix(member.phone))
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId) return
    setError(null)

    if (!isValidSaudiMobile(editPhone)) {
      setError(t('registerPet.invalidPhone'))
      return
    }

    setSavingEdit(true)
    const { error } = await supabase
      .from('caregivers')
      .update({
        name: editName,
        title: editTitle || null,
        phone: `+966${editPhone}`,
      })
      .eq('id', editingId)

    if (error) {
      setError(error.message)
      setSavingEdit(false)
      return
    }

    toast.success(t('staff.saved', { name: editName }))
    setEditingId(null)
    setSavingEdit(false)
    await loadStaff()
  }

  async function handleDelete(member: Caregiver) {
    const ok = await confirm(t('staff.deleteConfirm', { name: member.name, days: String(TRASH_RETENTION_DAYS) }), {
      danger: true,
      confirmLabel: t('common.delete'),
    })
    if (!ok) return
    const { error } = await supabase.from('caregivers').update({ deleted_at: new Date().toISOString() }).eq('id', member.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setStaff((current) => current.filter((s) => s.id !== member.id))
    toast.success(t('staff.removed', { name: member.name }))
  }

  async function openTrash() {
    setTrashModalOpen(true)
    setLoadingTrash(true)
    const { data, error } = await supabase
      .from('caregivers')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (error) toast.error(error.message)
    else setTrashedStaff(data ?? [])
    setLoadingTrash(false)
  }

  async function handleRestoreStaff(member: Caregiver) {
    setRestoringStaffId(member.id)
    const { error } = await supabase.from('caregivers').update({ deleted_at: null }).eq('id', member.id)
    if (error) {
      toast.error(error.message)
      setRestoringStaffId(null)
      return
    }
    setTrashedStaff((current) => current.filter((s) => s.id !== member.id))
    toast.success(t('trash.restored', { name: member.name }))
    setRestoringStaffId(null)
    await loadStaff()
  }

  async function handlePurgeStaff(member: Caregiver) {
    const ok = await confirm(t('trash.purgeConfirm', { name: member.name }), { danger: true, confirmLabel: t('trash.purgeNow') })
    if (!ok) return

    setPurgingStaffId(member.id)
    // appointments.assigned_staff_id has no cascade from caregivers — clear
    // it first (preserving the appointment itself) or the delete below
    // fails with a foreign-key violation.
    await supabase.from('appointments').update({ assigned_staff_id: null }).eq('assigned_staff_id', member.id)
    const { error } = await supabase.from('caregivers').delete().eq('id', member.id)
    if (error) {
      toast.error(error.message)
      setPurgingStaffId(null)
      return
    }
    setTrashedStaff((current) => current.filter((s) => s.id !== member.id))
    toast.success(t('trash.purged', { name: member.name }))
    setPurgingStaffId(null)
  }

  if (loading) return <LoadingScreen />

  return (
    <div>
      <div className="page-header">
        <h1>{t('staff.title')}</h1>
        <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
      </div>

      {error && <p className="form-error">{error}</p>}

      {staff.length === 0 ? (
        <p>{t('staff.none')}</p>
      ) : (
        <ul className="record-list">
          {staff.map((member) =>
            editingId === member.id ? (
              <li key={member.id}>
                <form onSubmit={handleSaveEdit} className="pet-form">
                  <label>
                    {t('common.name')}
                    <RequiredMark />
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
                  </label>
                  <label>
                    {t('staff.titleField')}
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder={t('staff.titlePlaceholder')}
                    />
                  </label>
                  <label>
                    {t('common.phone')}
                    <RequiredMark />
                    <PhoneInput
                      value={editPhone}
                      onChange={setEditPhone}
                      invalidMessage={t('registerPet.invalidPhone')}
                      required
                    />
                  </label>
                  <div className="record-edit-actions">
                    <button type="submit" disabled={savingEdit}>
                      {savingEdit ? t('common.saving') : t('common.save')}
                    </button>
                    <button type="button" className="cancel-button" onClick={() => setEditingId(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={member.id}>
                <div className="record-row">
                  <button
                    type="button"
                    className="pet-row-toggle"
                    onClick={() => setExpandedStaffId(expandedStaffId === member.id ? null : member.id)}
                  >
                    <strong>{member.name}</strong>
                    {member.title && ` — ${member.title}`}
                    {member.phone && (
                      <div className="pet-owner">
                        <Ltr>{member.phone}</Ltr>
                      </div>
                    )}
                  </button>
                  {isVet && (
                    <div className="record-actions">
                      <button type="button" className="secondary-button" onClick={() => startEditing(member)}>
                        {t('common.edit')}
                      </button>
                      <button type="button" className="delete-button" onClick={() => handleDelete(member)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  )}
                </div>
                {expandedStaffId === member.id && <StaffAppointments staffId={member.id} />}
              </li>
            ),
          )}
        </ul>
      )}

      {isVet && (
        <form onSubmit={handleAdd} className="pet-form pet-form-grid">
          <h2>{t('staff.addMember')}</h2>
          <label>
            {t('common.name')}
            <RequiredMark />
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            {t('staff.titleField')}
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('staff.titlePlaceholder')} />
          </label>
          <label>
            {t('common.phone')}
            <RequiredMark />
            <PhoneInput value={phone} onChange={setPhone} invalidMessage={t('registerPet.invalidPhone')} required />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? t('common.saving') : t('staff.addSubmit')}
          </button>
        </form>
      )}

      {isVet && (
        <button type="button" className="admin-trash-fab" onClick={openTrash} aria-label={t('trash.title')}>
          <Trash2 size={20} aria-hidden />
        </button>
      )}

      {trashModalOpen && (
        <div className="admin-modal-backdrop" onClick={() => setTrashModalOpen(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>
              {t('trash.title')} ({trashedStaff.length})
            </h2>
            {loadingTrash ? (
              <p>{t('common.loading')}</p>
            ) : trashedStaff.length === 0 ? (
              <p>{t('trash.empty')}</p>
            ) : (
              <ul className="record-list">
                {trashedStaff.map((member) => {
                  const deletedAt = new Date(member.deleted_at!)
                  const daysLeft = Math.max(
                    0,
                    TRASH_RETENTION_DAYS - Math.floor((Date.now() - deletedAt.getTime()) / (24 * 60 * 60 * 1000)),
                  )
                  return (
                    <li key={member.id}>
                      <div className="record-row">
                        <div>
                          <strong>{member.name}</strong>
                          <div className="pet-owner">
                            {t('trash.trashedOn')}: <Ltr>{formatDate(deletedAt)}</Ltr> ·{' '}
                            {t('trash.daysUntilPurge', { count: String(daysLeft) })}
                          </div>
                        </div>
                        <div className="record-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleRestoreStaff(member)}
                            disabled={restoringStaffId === member.id}
                          >
                            {restoringStaffId === member.id ? t('common.saving') : t('trash.restore')}
                          </button>
                          <button
                            type="button"
                            className="delete-button"
                            onClick={() => handlePurgeStaff(member)}
                            disabled={purgingStaffId === member.id}
                          >
                            {purgingStaffId === member.id ? t('common.saving') : t('trash.purgeNow')}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="record-edit-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="cancel-button" onClick={() => setTrashModalOpen(false)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default StaffPage
