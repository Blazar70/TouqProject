import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { Database } from '../lib/database.types'
import { downloadCsv } from '../lib/csvExport'
import RequiredMark from '../components/RequiredMark'
import LoadingScreen from '../components/LoadingScreen'
import Ltr from '../components/Ltr'
import ClinicPicker from '../components/ClinicPicker'
import { formatDate, formatIsoDate, formatMoney } from '../lib/format'
import FormError from '../components/FormError'

type Clinic = Database['public']['Tables']['clinics']['Row']
type Payment = Database['public']['Tables']['payments']['Row']

const PAYMENT_STATUSES = ['pending', 'paid', 'overdue', 'cancelled'] as const
const PAYMENT_DOCUMENTS_BUCKET = 'payment-documents'

function AdminBillingPage() {
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [billingSearch, setBillingSearch] = useState('')
  const [savingPaymentId, setSavingPaymentId] = useState<string | null>(null)
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null)
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null)
  const [showNewPaymentForm, setShowNewPaymentForm] = useState(false)
  const [newPaymentClinicId, setNewPaymentClinicId] = useState('')
  const [newPaymentAmount, setNewPaymentAmount] = useState('')
  const [newPaymentDueDate, setNewPaymentDueDate] = useState('')
  const [newPaymentFile, setNewPaymentFile] = useState<File | null>(null)
  const [creatingPayment, setCreatingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  async function load() {
    const [clinicsRes, paymentsRes] = await Promise.all([
      supabase.from('clinics').select('*').order('created_at', { ascending: false }),
      supabase.from('payments').select('*').order('created_at', { ascending: false }),
    ])
    setClinics(clinicsRes.data ?? [])
    setPayments(paymentsRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clinicNameById = useMemo(() => Object.fromEntries(clinics.map((c) => [c.id, c.name])), [clinics])

  const filteredPayments = useMemo(() => {
    const q = billingSearch.trim().toLowerCase()
    if (!q) return payments
    return payments.filter(
      (p) => p.status.toLowerCase().includes(q) || (clinicNameById[p.clinic_id] ?? '').toLowerCase().includes(q),
    )
  }, [payments, billingSearch, clinicNameById])

  async function handleCreatePayment(e: FormEvent) {
    e.preventDefault()
    setPaymentError(null)

    const amount = parseFloat(newPaymentAmount)
    if (!newPaymentClinicId || !newPaymentAmount || Number.isNaN(amount) || amount <= 0) {
      setPaymentError(t('admin.paymentInvalid'))
      return
    }
    if (newPaymentFile && newPaymentFile.type !== 'application/pdf') {
      setPaymentError(t('admin.paymentDocumentInvalidType'))
      return
    }

    setCreatingPayment(true)
    const { data, error } = await supabase
      .from('payments')
      .insert({ clinic_id: newPaymentClinicId, amount, due_date: newPaymentDueDate || null })
      .select('*')
      .single()

    if (error || !data) {
      setPaymentError(error?.message ?? t('common.couldNotSave'))
      setCreatingPayment(false)
      return
    }

    let created = data
    if (newPaymentFile) {
      const path = `${data.clinic_id}/${data.id}.pdf`
      const { error: uploadError } = await supabase.storage
        .from(PAYMENT_DOCUMENTS_BUCKET)
        .upload(path, newPaymentFile, { upsert: true, contentType: 'application/pdf' })
      if (uploadError) {
        toast.error(uploadError.message)
      } else {
        const { data: updated } = await supabase
          .from('payments')
          .update({ document_path: path })
          .eq('id', data.id)
          .select('*')
          .single()
        if (updated) created = updated
      }
    }

    setPayments((current) => [created, ...current])
    toast.success(t('admin.paymentCreated'))
    setNewPaymentClinicId('')
    setNewPaymentAmount('')
    setNewPaymentDueDate('')
    setNewPaymentFile(null)
    setShowNewPaymentForm(false)
    setCreatingPayment(false)
  }

  async function handleUpdatePaymentStatus(payment: Payment, status: string) {
    setSavingPaymentId(payment.id)
    const { data, error } = await supabase
      .from('payments')
      .update({ status, paid_at: status === 'paid' ? new Date().toISOString() : null })
      .eq('id', payment.id)
      .select('*')
      .single()

    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      setSavingPaymentId(null)
      return
    }

    setPayments((current) => current.map((p) => (p.id === data.id ? data : p)))
    setSavingPaymentId(null)
  }

  async function handleDeletePayment(payment: Payment) {
    const ok = await confirm(t('admin.deletePaymentConfirm'), { danger: true, confirmLabel: t('common.delete') })
    if (!ok) return

    setDeletingPaymentId(payment.id)
    if (payment.document_path) {
      await supabase.storage.from(PAYMENT_DOCUMENTS_BUCKET).remove([payment.document_path])
    }
    const { error } = await supabase.from('payments').delete().eq('id', payment.id)
    if (error) {
      toast.error(error.message)
      setDeletingPaymentId(null)
      return
    }
    setPayments((current) => current.filter((p) => p.id !== payment.id))
    setDeletingPaymentId(null)
  }

  async function handleAttachDocument(payment: Payment, file: File) {
    if (file.type !== 'application/pdf') {
      toast.error(t('admin.paymentDocumentInvalidType'))
      return
    }

    setUploadingDocId(payment.id)
    const path = `${payment.clinic_id}/${payment.id}.pdf`
    const { error: uploadError } = await supabase.storage
      .from(PAYMENT_DOCUMENTS_BUCKET)
      .upload(path, file, { upsert: true, contentType: 'application/pdf' })
    if (uploadError) {
      toast.error(uploadError.message)
      setUploadingDocId(null)
      return
    }

    const { data, error } = await supabase
      .from('payments')
      .update({ document_path: path })
      .eq('id', payment.id)
      .select('*')
      .single()
    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      setUploadingDocId(null)
      return
    }

    setPayments((current) => current.map((p) => (p.id === data.id ? data : p)))
    toast.success(t('admin.paymentDocumentAttached'))
    setUploadingDocId(null)
  }

  async function handleViewDocument(payment: Payment) {
    if (!payment.document_path) return
    const { data, error } = await supabase.storage
      .from(PAYMENT_DOCUMENTS_BUCKET)
      .createSignedUrl(payment.document_path, 60)
    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  function handleExportPaymentsCsv() {
    downloadCsv(
      'billing-ledger.csv',
      ['Clinic', 'Amount', 'Status', 'Due date', 'Paid on', 'Created'],
      filteredPayments.map((p) => [
        clinicNameById[p.clinic_id] ?? '',
        p.amount,
        p.status,
        p.due_date ? formatIsoDate(p.due_date) : '',
        p.paid_at ? formatIsoDate(p.paid_at) : '',
        formatIsoDate(p.created_at),
      ]),
    )
  }

  if (loading) return <LoadingScreen />

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>
            {t('admin.billingLedger')} ({filteredPayments.length})
          </h1>
          <p className="page-subtitle">{t('admin.billingLedgerHint')}</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="secondary-button" onClick={handleExportPaymentsCsv}>
            <Download size={14} aria-hidden style={{ marginInlineEnd: '0.3rem' }} />
            {t('admin.exportCsv')}
          </button>
          <button type="button" className="secondary-button" onClick={() => setShowNewPaymentForm((v) => !v)}>
            {showNewPaymentForm ? t('common.cancel') : `+ ${t('admin.newPayment')}`}
          </button>
        </div>
      </div>

      {showNewPaymentForm && (
        <form onSubmit={handleCreatePayment} className="pet-form pet-form-grid">
          <FormError message={paymentError} />
          <label>
            {t('admin.paymentClinic')}
            <RequiredMark />
            <ClinicPicker
              clinics={clinics.filter((c) => !c.deleted_at)}
              value={newPaymentClinicId}
              onChange={setNewPaymentClinicId}
            />
          </label>
          <label>
            {t('admin.paymentAmount')}
            <RequiredMark />
            <input
              type="number"
              className="no-spinner"
              dir="ltr"
              min="0.01"
              step="0.01"
              value={newPaymentAmount}
              onChange={(e) => setNewPaymentAmount(e.target.value)}
              required
            />
          </label>
          <label>
            {t('admin.paymentDueDate')}
            <input type="date" dir="ltr" value={newPaymentDueDate} onChange={(e) => setNewPaymentDueDate(e.target.value)} />
          </label>
          <div className="pet-form-file-field">
            <span className="pet-form-file-field-label">{t('admin.paymentDocument')}</span>
            <label className="secondary-button admin-file-label">
              {newPaymentFile ? newPaymentFile.name : t('admin.paymentAttachDocument')}
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setNewPaymentFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <button type="submit" className="primary-button" disabled={creatingPayment}>
            {creatingPayment ? t('common.saving') : t('admin.createPayment')}
          </button>
        </form>
      )}

      <input
        type="search"
        className="search-input"
        placeholder={t('admin.searchPayments')}
        value={billingSearch}
        onChange={(e) => setBillingSearch(e.target.value)}
      />

      {filteredPayments.length === 0 ? (
        <p>{t('admin.noPaymentsMatch')}</p>
      ) : (
        <ul className="pet-list data-table data-billing">
          <li className="data-head" aria-hidden>
            <span>{t('admin.paymentClinic')}</span>
            <span className="data-num">{t('list.amount')}</span>
            <span>{t('admin.paymentDueDate')}</span>
            <span>{t('admin.paymentPaidOn')}</span>
            <span>{t('list.status')}</span>
            <span />
          </li>
          {filteredPayments.map((payment) => (
            <li key={payment.id} className="pet-list-item">
              <div className="pet-row data-row">
                <strong className="data-cell-wide data-strong">{clinicNameById[payment.clinic_id] ?? '—'}</strong>
                <span className="data-num data-strong">
                  <Ltr>{formatMoney(payment.amount)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
                </span>
                <span className="data-muted">
                  {payment.due_date && (
                    <>
                      <span className="data-label">{t('admin.paymentDueDate')}: </span>
                      <Ltr>{formatDate(payment.due_date)}</Ltr>
                    </>
                  )}
                </span>
                <span className="data-muted">
                  {payment.paid_at && (
                    <>
                      <span className="data-label">{t('admin.paymentPaidOn')}: </span>
                      <Ltr>{formatDate(payment.paid_at)}</Ltr>
                    </>
                  )}
                </span>
                <span>
                  <span className={`status-badge status-${payment.status === 'paid' ? 'active' : payment.status}`}>
                    {payment.status}
                  </span>
                </span>
                <div className="record-actions data-end">
                  <select
                    value={payment.status}
                    onChange={(e) => handleUpdatePaymentStatus(payment, e.target.value)}
                    disabled={savingPaymentId === payment.id}
                  >
                    {PAYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {payment.document_path && (
                    <button type="button" className="secondary-button" onClick={() => handleViewDocument(payment)}>
                      {t('admin.paymentViewDocument')}
                    </button>
                  )}
                  <label className="secondary-button admin-file-label">
                    {uploadingDocId === payment.id
                      ? t('common.saving')
                      : payment.document_path
                        ? t('admin.paymentReplaceDocument')
                        : t('admin.paymentAttachDocument')}
                    <input
                      type="file"
                      accept="application/pdf"
                      disabled={uploadingDocId === payment.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) handleAttachDocument(payment, file)
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="delete-button"
                    onClick={() => handleDeletePayment(payment)}
                    disabled={deletingPaymentId === payment.id}
                  >
                    {deletingPaymentId === payment.id ? t('common.saving') : t('common.delete')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default AdminBillingPage
