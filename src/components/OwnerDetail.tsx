import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import { useToast } from '../lib/ToastContext'
import { useConfirm } from '../lib/ConfirmContext'
import { usePrintSummary } from '../lib/PrintContext'
import type { Database } from '../lib/database.types'
import { formatDateTime, formatMoney } from '../lib/format'
import { isValidSaudiMobile, stripSaudiPrefix } from '../lib/phone'
import { METHOD_LABEL_KEYS, PAYMENT_METHODS } from '../lib/invoiceMath'
import { balancesAfter } from '../lib/owners'
import { BALANCE_EMBED, flatBalance } from '../lib/owners'
import { collectOwnerData, downloadOwnerJson, ownerReport } from '../lib/ownerExport'
import type { OwnerData } from '../lib/ownerExport'
import { speciesLabel } from '../lib/species'
import OwnerPickerModal from './OwnerPickerModal'
import PaymentStatusBadge from './PaymentStatusBadge'
import PetAvatar from './PetAvatar'
import PhoneInput from './PhoneInput'
import RequiredMark from './RequiredMark'
import LoadingScreen from './LoadingScreen'
import Ltr from './Ltr'
import FormError from './FormError'
import Modal from './Modal'

type Tables = Database['public']['Tables']
type Owner = Tables['owner_files']['Row'] & { balance: number }
type Entry = Tables['owner_balance_entries']['Row']
type Pet = Tables['pets']['Row']
type InvoiceRow = { id: string; invoice_number: string; created_at: string; amount_total: number; payment_status: string; pets: { name: string } | null }
type TopUpMethod = (typeof PAYMENT_METHODS)[number]
type Modal = 'topup' | 'adjust' | 'merge' | { move: Pet } | null

function Money({ amount, signed }: { amount: number; signed?: boolean }) {
  const { t } = useLanguage()
  return (
    <>
      <Ltr>{`${signed && amount > 0 ? '+' : ''}${formatMoney(amount)}`}</Ltr> <span className="money-currency">{t('common.currency')}</span>
    </>
  )
}

// One owner file: contact, pets, balance and its history, invoices; top up,
// adjust, merge another owner in, move a pet out (0063-0064).
function OwnerDetail({ ownerId, onClose }: { ownerId: string; onClose: () => void }) {
  const { profile, handlesMoney } = useAuth()
  const { branchId, branchName } = useBranch()
  const { t } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const { printInvoice, printReport } = usePrintSummary()
  const isManager = profile?.clinic_role === 'manager'

  const [owner, setOwner] = useState<Owner | null>(null)
  const [pets, setPets] = useState<Pet[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')

  const [modal, setModal] = useState<Modal>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<TopUpMethod>('cash')
  const [reason, setReason] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [doneEntryId, setDoneEntryId] = useState<string | null>(null)
  const [exportData, setExportData] = useState<OwnerData | null>(null)

  const load = useCallback(async () => {
    const [o, p, e] = await Promise.all([
      supabase.from('owner_files').select(`*, ${BALANCE_EMBED}`).eq('id', ownerId).maybeSingle(),
      supabase.from('pets').select('*').eq('owner_file_id', ownerId).is('deleted_at', null).order('created_at'),
      supabase.from('owner_balance_entries').select('*').eq('owner_file_id', ownerId).order('created_at', { ascending: false }),
    ])
    const loadError = o.error ?? p.error ?? e.error
    if (loadError) setError(loadError.message)
    setOwner(o.data ? flatBalance(o.data) : null)
    setPets(p.data ?? [])
    setEntries(e.data ?? [])
    const petIds = (p.data ?? []).map((pet) => pet.id)
    if (petIds.length) {
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, created_at, amount_total, payment_status, pets(name)')
        .in('pet_id', petIds)
        .order('created_at', { ascending: false })
      setInvoices((data ?? []) as unknown as InvoiceRow[])
    } else setInvoices([])
    setLoading(false)
  }, [ownerId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  if (loading) return <LoadingScreen />
  if (!owner) {
    return (
      <div>
        <p className="empty-state">{error ?? t('owners.noneMatch')}</p>
        <button type="button" className="secondary-button" onClick={onClose}>
          {t('owners.back')}
        </button>
      </div>
    )
  }
  const current = owner
  const after = balancesAfter(current.balance, entries.map((entry) => entry.amount))

  function startEdit() {
    setName(current.name)
    setPhone(stripSaudiPrefix(current.phone))
    setEmail(current.email ?? '')
    setNotes(current.notes ?? '')
    setEditing(true)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (phone && !isValidSaudiMobile(phone)) {
      setError(t('registerPet.invalidPhone'))
      return
    }
    setSaving(true)
    const { error: saveError } = await supabase
      .from('owner_files')
      .update({ name: name.trim(), phone: phone ? `+966${phone}` : null, email: email.trim() || null, notes: notes.trim() || null })
      .eq('id', current.id)
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setError(null)
    setEditing(false)
    toast.success(t('owners.saved'))
    load()
  }

  function openModal(next: Modal) {
    setModal(next)
    setAmount('')
    setMethod('cash')
    setReason('')
    setModalError(null)
    setDoneEntryId(null)
  }

  function printReceipt(entry: Entry, balanceAfter: number) {
    printInvoice({
      kind: 'deposit',
      number: entry.receipt_number ?? entry.id.slice(0, 8).toUpperCase(),
      date: entry.created_at,
      branch: entry.branch_id ? branchName(entry.branch_id) : '—',
      vatNumber: null,
      pet: null,
      lines: [],
      total: entry.amount,
      vat: 0,
      vatRate: null,
      payments: [{ method: METHOD_LABEL_KEYS[entry.method ?? 'cash'], amount: entry.amount, paidAt: entry.created_at }],
      owner: current.name,
      balanceAfter,
    })
  }

  async function handleBalance(e: FormEvent) {
    e.preventDefault()
    const value = parseFloat(amount)
    const adjusting = modal === 'adjust'
    if (!value || (!adjusting && value < 0)) {
      setModalError(t('payments.invalidAmount'))
      return
    }
    if (adjusting && !reason.trim()) {
      setModalError(t('owners.reasonRequired'))
      return
    }
    setSaving(true)
    const { data: id, error: rpcError } = await supabase.rpc('add_owner_balance', {
      p_owner: current.id,
      p_amount: value,
      p_method: adjusting ? null : method,
      p_reason: adjusting ? reason.trim() : null,
      p_branch: branchId,
    })
    setSaving(false)
    if (rpcError) {
      const available = rpcError.message.match(/available ([\d.]+)/)?.[1]
      setModalError(available ? t('owners.notEnoughBalance', { amount: `${formatMoney(Number(available))} ${t('common.currency')}` }) : rpcError.message)
      return
    }
    await load()
    if (adjusting) {
      setModal(null)
      toast.success(t('owners.saved'))
    } else {
      toast.success(t('owners.toppedUp', { amount: `${formatMoney(value)} ${t('common.currency')}`, name: current.name }))
      setDoneEntryId(id)
    }
  }

  async function handleMerge(other: { id: string; name: string; balance: number }) {
    setModal(null)
    const ok = await confirm(
      t('owners.mergeConfirm', { other: other.name, name: current.name, amount: `${formatMoney(other.balance)} ${t('common.currency')}` }),
      { confirmLabel: t('owners.merge') },
    )
    if (!ok) return
    const { error: rpcError } = await supabase.rpc('merge_owner_files', { p_keep: current.id, p_remove: other.id })
    if (rpcError) {
      toast.error(rpcError.message)
      return
    }
    toast.success(t('owners.merged'))
    load()
  }

  // Gathered first, then printed/downloaded from the pop-up: a print window opened after an await is blocked.
  async function handleExport() {
    try {
      setExportData(await collectOwnerData(current.id))
    } catch (exportError) {
      toast.error((exportError as Error).message)
    }
  }

  async function handleAnonymise() {
    const ok = await confirm(t('owners.deleteDataConfirm', { name: current.name }), { danger: true, confirmLabel: t('owners.deleteData') })
    if (!ok) return
    const { error: rpcError } = await supabase.rpc('anonymise_owner_file', { p_owner: current.id })
    if (rpcError) return toast.error(rpcError.message)
    toast.success(t('owners.dataDeleted'))
    load()
  }

  async function handleMove(pet: Pet, target: { id: string; name: string }) {
    setModal(null)
    const { error: moveError } = await supabase.from('pets').update({ owner_file_id: target.id }).eq('id', pet.id)
    if (moveError) {
      toast.error(moveError.message)
      return
    }
    toast.success(t('owners.moved', { pet: pet.name, name: target.name }))
    load()
  }

  function entryDetail(entry: Entry) {
    if (entry.method) return t(METHOD_LABEL_KEYS[entry.method])
    if (entry.reason) return entry.reason
    return invoices.find((inv) => inv.id === entry.invoice_id)?.invoice_number ?? ''
  }

  const doneIndex = entries.findIndex((entry) => entry.id === doneEntryId)

  return (
    <div className="owner-detail">
      <button type="button" className="secondary-button owner-back" onClick={onClose}>
        <ArrowLeft className="nav-icon-flip" size={16} aria-hidden /> {t('owners.back')}
      </button>

      <div className="page-header">
        <h1>{current.name}</h1>
        <div className="page-header-actions">
          <button type="button" className="secondary-button" onClick={startEdit}>
            {t('common.edit')}
          </button>
          {/* Merge and move: receptionists and managers, the same roles as money (0076). */}
          {handlesMoney && (
            <button type="button" className="secondary-button" onClick={() => openModal('merge')}>
              {t('owners.merge')}
            </button>
          )}
          {isManager && (
            <button type="button" className="secondary-button" onClick={() => openModal('adjust')}>
              {t('owners.adjust')}
            </button>
          )}
          {/* PDPL requests (0089): a copy of the owner's data, or deleting it. Managers only. */}
          {isManager && (
            <button type="button" className="secondary-button" onClick={handleExport}>
              {t('owners.exportData')}
            </button>
          )}
          {isManager && !current.anonymised_at && (
            <button type="button" className="delete-button" onClick={handleAnonymise}>
              {t('owners.deleteData')}
            </button>
          )}
          {handlesMoney && (
            <button type="button" className="primary-button" onClick={() => openModal('topup')}>
              {t('owners.addBalance')}
            </button>
          )}
        </div>
      </div>
      <FormError message={error} />

      {/* Balance, its history and invoices: receptionists and managers only (0074). */}
      <div className={handlesMoney ? 'owner-detail-grid' : undefined}>
        <div>
          {handlesMoney && (
          <div className="stat-row">
            <div className="stat-tile">
              <div className="stat-number">
                <Ltr>{formatMoney(current.balance)}</Ltr>
              </div>
              <div className="stat-label">
                {t('owners.balance')} ({t('common.currency')})
              </div>
            </div>
          </div>
          )}

          <section className="settings-section">
            {editing ? (
              <form onSubmit={handleSave} className="pet-form">
                <label>
                  {t('common.name')}
                  <RequiredMark />
                  <input value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label>
                  {t('common.phone')}
                  <PhoneInput value={phone} onChange={setPhone} invalidMessage={t('registerPet.invalidPhone')} />
                </label>
                <label>
                  {t('owners.email')}
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label>
                  {t('owners.notes')}
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                </label>
                <div className="record-edit-actions">
                  <button type="submit" className="primary-button" disabled={saving}>
                    {saving ? t('common.saving') : t('common.saveChanges')}
                  </button>
                  <button type="button" className="cancel-button" onClick={() => setEditing(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            ) : (
              <dl className="owner-contact">
                <dt>{t('common.phone')}</dt>
                <dd>{current.phone ? <Ltr>{current.phone}</Ltr> : '—'}</dd>
                <dt>{t('owners.email')}</dt>
                <dd>{current.email ? <Ltr>{current.email}</Ltr> : '—'}</dd>
                {current.notes && (
                  <>
                    <dt>{t('owners.notes')}</dt>
                    <dd className="owner-notes">{current.notes}</dd>
                  </>
                )}
              </dl>
            )}
          </section>

          <section className="settings-section">
            <h2>{t('owners.pets')}</h2>
            {pets.length === 0 ? (
              <p className="pet-owner">{t('owners.noPets')}</p>
            ) : (
              <ul className="record-list">
                {pets.map((pet) => (
                  <li key={pet.id} className="record-row owner-pet-row">
                    <Link to={`/pets/${pet.id}`} className="owner-pet-link">
                      <PetAvatar pet={pet} size={40} />
                      <span>
                        <strong>{pet.name}</strong>
                        <span className="pet-owner">
                          {speciesLabel(t, pet.species)} · {t('pets.petId')} <Ltr>{pet.pet_number}</Ltr>
                        </span>
                      </span>
                    </Link>
                    {handlesMoney && (
                      <button type="button" className="secondary-button" onClick={() => openModal({ move: pet })}>
                        {t('owners.move')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {handlesMoney && (
        <div>
          <section className="settings-section">
            <h2>{t('owners.history')}</h2>
            {entries.length === 0 ? (
              <p className="pet-owner">{t('owners.noHistory')}</p>
            ) : (
              <ul className="record-list">
                {entries.map((entry, i) => (
                  <li key={entry.id} className="record-row">
                    <span>
                      <strong>{t(`owners.kind.${entry.kind}` as TranslationKey)}</strong>
                      <span className="pet-owner">
                        <Ltr>{formatDateTime(entry.created_at)}</Ltr>
                        {entryDetail(entry) && <> · {entryDetail(entry)}</>}
                      </span>
                    </span>
                    <span className="record-actions">
                      <span className="data-num data-strong">
                        <Money amount={entry.amount} signed />
                      </span>
                      {entry.kind === 'top_up' && (
                        <button type="button" className="secondary-button" onClick={() => printReceipt(entry, after[i])}>
                          {t('owners.printReceipt')}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="settings-section">
            <h2>{t('owners.invoices')}</h2>
            {invoices.length === 0 ? (
              <p className="pet-owner">{t('owners.noInvoices')}</p>
            ) : (
              <ul className="record-list">
                {invoices.map((inv) => (
                  <li key={inv.id} className="record-row">
                    <span>
                      <strong>
                        <Link to={`/payments?invoice=${inv.id}`}>
                          <Ltr>{inv.invoice_number}</Ltr>
                        </Link>
                      </strong>
                      <span className="pet-owner">
                        {inv.pets?.name} · <Ltr>{formatDateTime(inv.created_at)}</Ltr>
                      </span>
                    </span>
                    <span className="record-actions">
                      <span className="data-num data-strong">
                        <Money amount={inv.amount_total} />
                      </span>
                      <PaymentStatusBadge status={inv.payment_status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        )}
      </div>

      {(modal === 'topup' || modal === 'adjust') && (
        <Modal onClose={() => setModal(null)} labelledBy="balance-title">
            <h2 id="balance-title">{t(modal === 'topup' ? 'owners.addBalance' : 'owners.adjust')}</h2>
            <p className="pet-owner">
              {current.name} · {t('owners.balance')} <Money amount={current.balance} />
            </p>
            {doneEntryId && doneIndex >= 0 ? (
              <div className="admin-modal-actions">
                <button type="button" className="cancel-button" onClick={() => setModal(null)}>
                  {t('common.close')}
                </button>
                <button type="button" className="primary-button" onClick={() => printReceipt(entries[doneIndex], after[doneIndex])}>
                  {t('owners.printReceipt')}
                </button>
              </div>
            ) : (
              <form onSubmit={handleBalance} className="pet-form">
                <FormError message={modalError} />
                <label>
                  {t('payments.amount')}
                  <RequiredMark />
                  <input
                    type="number"
                    inputMode="decimal"
                    className="no-spinner"
                    dir="ltr"
                    step="0.01"
                    min={modal === 'topup' ? '0.01' : undefined}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    autoFocus
                  />
                </label>
                {modal === 'topup' ? (
                  <div className="method-toggle" role="group" aria-label={t('payments.method')}>
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={method === m}
                        className={`secondary-button${method === m ? ' method-toggle-active' : ''}`}
                        onClick={() => setMethod(m)}
                      >
                        {t(METHOD_LABEL_KEYS[m])}
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <p className="pet-owner">{t('owners.adjustHint')}</p>
                    <label>
                      {t('owners.reason')}
                      <RequiredMark />
                      <input value={reason} onChange={(e) => setReason(e.target.value)} required />
                    </label>
                  </>
                )}
                <div className="admin-modal-actions">
                  <button type="button" className="cancel-button" onClick={() => setModal(null)}>
                    {t('common.cancel')}
                  </button>
                  <button type="submit" className="primary-button" disabled={saving}>
                    {saving ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </form>
            )}
        </Modal>
      )}

      {modal === 'merge' && (
        <OwnerPickerModal
          title={t('owners.mergeTitle', { name: current.name })}
          excludeId={current.id}
          onPick={handleMerge}
          onClose={() => setModal(null)}
        />
      )}
      {modal !== null && typeof modal === 'object' && (
        <OwnerPickerModal
          title={t('owners.moveTitle', { pet: modal.move.name })}
          excludeId={current.id}
          allowNew
          onPick={(target) => handleMove(modal.move, target)}
          onClose={() => setModal(null)}
        />
      )}
      {exportData && (
        <Modal onClose={() => setExportData(null)} labelledBy="export-title">
          <h2 id="export-title">{t('owners.exportData')}</h2>
          <p className="pet-owner">{t('ownerExport.ready', { name: current.name })}</p>
          <div className="admin-modal-actions">
            <button type="button" className="primary-button" onClick={() => printReport(ownerReport(t, exportData))}>
              {t('ownerExport.print')}
            </button>
            <button type="button" className="secondary-button" onClick={() => downloadOwnerJson(exportData)}>
              {t('ownerExport.download')}
            </button>
            <button type="button" className="cancel-button" onClick={() => setExportData(null)}>
              {t('common.close')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default OwnerDetail
