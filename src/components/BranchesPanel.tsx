import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import { useConfirm } from '../lib/ConfirmContext'
import { isValidClinicPhone } from '../lib/phone'
import { defaultInvoiceCode, isValidInvoiceCode } from '../lib/invoiceMath'
import type { Database } from '../lib/database.types'
import Ltr from './Ltr'
import RequiredMark from './RequiredMark'
import FormError from './FormError'

type Branch = Database['public']['Tables']['branches']['Row']

type Props = {
  clinicId: string
  /** This clinic's branches, closed ones included. */
  branches: Branch[]
  /** Memberships, for the "staff will move to main" count when closing. */
  staffBranches: { profile_id: string; branch_id: string }[]
  /** Add, make main, close, reopen: admins and whole-clinic managers (0048/0056). */
  canManage: boolean
  /** Edit name/phone/address: everything for canManage, own branches for branch managers. */
  canEdit: (branch: Branch) => boolean
  onChanged: () => void
}

// Branch list + add/edit form. Used by the admin Clinics page and the manager's Settings.
// Writes are plain updates under RLS; close and make-main are DB functions so they can't half-finish.
function BranchesPanel({ clinicId, branches, staffBranches, canManage, canEdit, onChanged }: Props) {
  const { t, language } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  // One form for adding (branchId null) and editing a branch.
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [invoiceCode, setInvoiceCode] = useState('')
  // The DB refuses a code change once the branch has invoices (0060); this just greys the field out.
  const [codeLocked, setCodeLocked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  function label(b: Branch) {
    return (language === 'ar' && b.name_ar) || b.name
  }

  function openForm(branch: Branch | null) {
    setFormOpen(true)
    setEditingId(branch?.id ?? null)
    setName(branch?.name ?? '')
    setNameAr(branch?.name_ar ?? '')
    setPhone(branch?.phone ?? '')
    setAddress(branch?.address ?? '')
    setInvoiceCode(branch?.invoice_code ?? '')
    setCodeLocked(false)
    setError(null)
    if (branch) {
      supabase
        .from('invoices')
        .select('id')
        .eq('branch_id', branch.id)
        .limit(1)
        .then(({ data }) => setCodeLocked((data ?? []).length > 0))
    }
  }

  const takenCodes = branches.filter((b) => b.id !== editingId).map((b) => b.invoice_code)
  const suggestedCode = defaultInvoiceCode(name.trim(), takenCodes)

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (phone.trim() && !isValidClinicPhone(phone.trim())) {
      setError(t('registerPet.invalidPhone'))
      return
    }
    const code = invoiceCode.trim() || suggestedCode
    if (!isValidInvoiceCode(code)) {
      setError(t('admin.invoiceCodeInvalid'))
      return
    }
    setSaving(true)
    const fields = {
      name: trimmed,
      name_ar: nameAr.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      invoice_code: code,
    }
    const { error: saveError } = editingId
      ? await supabase.from('branches').update(fields).eq('id', editingId)
      : await supabase.from('branches').insert({ ...fields, clinic_id: clinicId })
    setSaving(false)
    if (saveError) {
      setError(
        saveError.message.includes('invoice_code')
          ? t('admin.invoiceCodeTaken')
          : saveError.message.includes('invoice code')
            ? t('admin.invoiceCodeLocked')
            : saveError.code === '23505'
              ? t('admin.branchNameTaken')
              : saveError.message,
      )
      return
    }
    toast.success(t(editingId ? 'admin.branchSaved' : 'admin.branchAdded', { name: trimmed }))
    setFormOpen(false)
    onChanged()
  }

  async function handleMakeMain(branch: Branch) {
    setBusyId(branch.id)
    const { error: rpcError } = await supabase.rpc('admin_set_main_branch', { p_branch: branch.id })
    setBusyId(null)
    if (rpcError) {
      toast.error(rpcError.message)
      return
    }
    toast.success(t('admin.branchMadeMain', { name: label(branch) }))
    onChanged()
  }

  async function handleClose(branch: Branch) {
    // Same rule as admin_close_branch: staff with no other branch move to main.
    const moving = staffBranches.filter(
      (sb) => sb.branch_id === branch.id && !staffBranches.some((o) => o.profile_id === sb.profile_id && o.branch_id !== branch.id),
    ).length
    const ok = await confirm(t('admin.closeBranchConfirm', { name: label(branch), count: String(moving) }), {
      danger: true,
      confirmLabel: t('admin.closeBranch'),
    })
    if (!ok) return
    setBusyId(branch.id)
    const { error: rpcError } = await supabase.rpc('admin_close_branch', { p_branch: branch.id })
    setBusyId(null)
    if (rpcError) {
      toast.error(rpcError.message)
      return
    }
    toast.success(t('admin.branchClosed', { name: label(branch) }))
    onChanged()
  }

  async function handleReopen(branch: Branch) {
    setBusyId(branch.id)
    const { error: reopenError } = await supabase.from('branches').update({ active: true }).eq('id', branch.id)
    setBusyId(null)
    if (reopenError) {
      toast.error(reopenError.message)
      return
    }
    toast.success(t('admin.branchReopened', { name: label(branch) }))
    onChanged()
  }

  return (
    <>
      <ul className="record-list">
        {branches.map((b) => (
          <li key={b.id}>
            <div className="record-row">
              <div>
                <strong>{b.name}</strong>
                {b.name_ar && <span className="pet-owner"> · {b.name_ar}</span>}
                <span className="pet-owner">
                  {' · '}
                  <Ltr>{b.invoice_code}</Ltr>
                </span>
                {b.is_main && <>{' '}<span className="status-badge status-confirmed">{t('admin.mainBranch')}</span></>}
                {!b.active && <>{' '}<span className="status-badge status-cancelled">{t('admin.branchClosedBadge')}</span></>}
                {(b.phone || b.address) && (
                  <div className="pet-owner">
                    {b.phone && <Ltr>{b.phone}</Ltr>}
                    {b.phone && b.address && ' · '}
                    {b.address}
                  </div>
                )}
              </div>
              <div className="record-actions">
                {canEdit(b) && (
                  <button type="button" className="secondary-button" onClick={() => openForm(b)}>
                    {t('common.edit')}
                  </button>
                )}
                {canManage && b.active && !b.is_main && (
                  <>
                    <button type="button" className="secondary-button" onClick={() => handleMakeMain(b)} disabled={busyId === b.id}>
                      {t('admin.makeMainBranch')}
                    </button>
                    <button type="button" className="delete-button" onClick={() => handleClose(b)} disabled={busyId === b.id}>
                      {t('admin.closeBranch')}
                    </button>
                  </>
                )}
                {canManage && !b.active && (
                  <button type="button" className="secondary-button" onClick={() => handleReopen(b)} disabled={busyId === b.id}>
                    {t('admin.reopenBranch')}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {formOpen ? (
        <form onSubmit={handleSave} className="pet-form pet-form-grid">
          <FormError message={error} />
          <label>
            {t('admin.branchName')}
            <RequiredMark />
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            {t('admin.branchNameAr')}
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
          </label>
          <label>
            {t('common.phone')}
            <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="+966 11 234 5678" />
          </label>
          <label>
            {t('admin.branchAddress')}
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label>
            {t('admin.invoiceCode')}
            <input
              value={invoiceCode}
              onChange={(e) => setInvoiceCode(e.target.value.toUpperCase())}
              placeholder={suggestedCode}
              dir="ltr"
              maxLength={6}
              autoCapitalize="characters"
              disabled={codeLocked}
              aria-describedby="invoice-code-hint"
            />
            <span id="invoice-code-hint" className="pet-owner">
              {t(codeLocked ? 'admin.invoiceCodeLocked' : 'admin.invoiceCodeHint')}
            </span>
          </label>
          <div className="record-edit-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('common.saving') : editingId ? t('common.save') : t('admin.addBranch')}
            </button>
            <button type="button" className="cancel-button" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        canManage && (
          <button type="button" className="secondary-button" onClick={() => openForm(null)}>
            + {t('admin.addBranch')}
          </button>
        )
      )}
    </>
  )
}

export default BranchesPanel
