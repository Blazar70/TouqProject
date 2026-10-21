import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import { usePrintSummary } from '../lib/PrintContext'
import type { InvoiceDoc } from '../lib/PrintContext'
import { formatDateTime, formatMoney } from '../lib/format'
import { INVOICE_SELECT, METHOD_LABEL_KEYS, PAYMENT_METHODS, amountRemaining } from '../lib/invoiceMath'
import type { InvoiceFull, PaymentMethod } from '../lib/invoiceMath'
import PaymentStatusBadge from './PaymentStatusBadge'
import Ltr from './Ltr'
import RequiredMark from './RequiredMark'

type Props = {
  invoice: InvoiceFull
  branchName: string
  vatNumber: string | null
  isManager: boolean
  /** The picked branch, where an added payment is received. */
  branchId: string | null
  onChanged: (invoice: InvoiceFull) => void
  onClose: () => void
}

function Money({ amount }: { amount: number }) {
  const { t } = useLanguage()
  return (
    <>
      <Ltr>{formatMoney(amount)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
    </>
  )
}

function MethodToggle({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  const { t } = useLanguage()
  return (
    <div className="method-toggle">
      {PAYMENT_METHODS.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          className={`secondary-button${value === m ? ' method-toggle-active' : ''}`}
          onClick={() => onChange(m)}
        >
          {t(METHOD_LABEL_KEYS[m])}
        </button>
      ))}
    </div>
  )
}

// One invoice: lines, discounts, totals, payments, credit notes; add a payment,
// issue a credit note, print. Every write is a DB function (0061).
function InvoiceDetail({ invoice, branchName, vatNumber, isManager, branchId, onChanged, onClose }: Props) {
  const { t } = useLanguage()
  const toast = useToast()
  const { printInvoice } = usePrintSummary()
  const [mode, setMode] = useState<'view' | 'pay' | 'credit'>('view')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState('')
  const [creditItems, setCreditItems] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const items = [...invoice.invoice_items].sort((a, b) => a.position - b.position)
  const remaining = amountRemaining(invoice)
  const creditable = Math.round((invoice.amount_total - invoice.amount_credited) * 100) / 100
  const credited = new Set(invoice.credit_notes.flatMap((c) => c.item_ids))
  const rates = new Set(items.map((i) => i.vat_rate))
  const vatRate = rates.size === 1 ? [...rates][0] : null
  const discountLabel = (type: string | null, value: number | null, why: string | null) =>
    t('payments.discountLabel', { value: type === 'percent' ? `${value}%` : `${formatMoney(value ?? 0)} ${t('common.currency')}`, reason: why ?? '' })

  function open(next: 'pay' | 'credit') {
    setMode(next)
    setMethod('cash')
    setAmount(next === 'pay' ? remaining.toFixed(2) : '')
    setCreditItems([])
    setReason('')
    setError(null)
  }

  async function reload() {
    const { data } = await supabase.from('invoices').select(INVOICE_SELECT).eq('id', invoice.id).single()
    if (data) onChanged(data as unknown as InvoiceFull)
  }

  async function handlePay(e: FormEvent) {
    e.preventDefault()
    const value = parseFloat(amount)
    if (!(value > 0) || value > remaining) {
      setError(t('payments.invalidAmount'))
      return
    }
    setSaving(true)
    const { error: rpcError } = await supabase.rpc('add_invoice_payment', { p_invoice: invoice.id, p_method: method, p_amount: value, p_branch: branchId })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    toast.success(t('payments.paymentAdded'))
    setMode('view')
    reload()
  }

  async function handleCredit(e: FormEvent) {
    e.preventDefault()
    if (!reason.trim()) {
      setError(t('payments.reasonRequired'))
      return
    }
    const value = amount.trim() ? parseFloat(amount) : null
    if (value !== null && !(value > 0 && value <= creditable)) {
      setError(t('payments.creditTooMuch'))
      return
    }
    setSaving(true)
    const { data, error: rpcError } = await supabase.rpc('create_credit_note', {
      p_invoice: invoice.id,
      p_item_ids: creditItems.length ? creditItems : null,
      // Nothing picked and no amount: credit everything left.
      p_amount: value ?? (creditItems.length ? null : creditable),
      p_reason: reason.trim(),
      p_refund_method: method,
    })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message.includes('more than what is left') ? t('payments.creditTooMuch') : rpcError.message)
      return
    }
    const { data: note } = await supabase.from('credit_notes').select('credit_number').eq('id', data).single()
    toast.success(t('payments.creditIssued', { number: note?.credit_number ?? '' }))
    setMode('view')
    reload()
  }

  const pet = invoice.pets ? { name: invoice.pets.name, number: invoice.pets.pet_number } : null

  function printThis() {
    printInvoice({
      kind: 'invoice',
      number: invoice.invoice_number,
      date: invoice.created_at,
      branch: branchName,
      vatNumber,
      pet,
      lines: items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        total: i.line_total,
        discount: i.discount_amount > 0 ? { label: discountLabel(i.discount_type, i.discount_value, i.discount_reason), amount: i.discount_amount } : undefined,
      })),
      billDiscount:
        invoice.discount_amount > 0
          ? { label: discountLabel(invoice.discount_type, invoice.discount_value, invoice.discount_reason), amount: invoice.discount_amount }
          : undefined,
      total: invoice.amount_total,
      vat: invoice.vat_total,
      vatRate,
      payments: invoice.invoice_payments.map((p) => ({ method: METHOD_LABEL_KEYS[p.method], amount: p.amount, paidAt: p.paid_at })),
      paid: invoice.amount_paid - invoice.amount_refunded,
      credited: invoice.amount_credited,
      remaining,
    })
  }

  function printCredit(note: InvoiceFull['credit_notes'][number]) {
    const doc: InvoiceDoc = {
      kind: 'credit_note',
      number: note.credit_number,
      invoiceNumber: invoice.invoice_number,
      date: note.created_at,
      branch: branchName,
      vatNumber,
      pet,
      lines: items
        .filter((i) => note.item_ids.includes(i.id))
        .map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unit_price, total: i.line_total })),
      total: note.amount,
      vat: note.vat_amount,
      vatRate,
      reason: note.reason,
      refund: note.refund_amount > 0 ? { method: METHOD_LABEL_KEYS[note.refund_method], amount: note.refund_amount } : undefined,
    }
    printInvoice(doc)
  }

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card invoice-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-title" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2 id="invoice-title">
            <Ltr>{invoice.invoice_number}</Ltr>
          </h2>
          <PaymentStatusBadge status={invoice.payment_status} />
        </div>
        <p className="pet-owner">
          {invoice.pets?.name ?? '—'}
          {invoice.pets && (
            <>
              {' · '}
              {t('pets.petId')} <Ltr>{invoice.pets.pet_number}</Ltr>
            </>
          )}
          {' · '}
          {branchName} · <Ltr>{formatDateTime(invoice.created_at)}</Ltr>
        </p>

        <ul className="invoice-lines">
          {items.map((i) => (
            <li key={i.id}>
              <div className="invoice-line">
                <span>
                  {i.description} <span className="data-muted">× {i.quantity}</span>
                  {credited.has(i.id) && <span className="data-muted"> · {t('payments.alreadyCredited')}</span>}
                </span>
                <span className="data-num">
                  <Money amount={i.line_total + i.discount_amount} />
                </span>
              </div>
              {i.discount_amount > 0 && (
                <div className="invoice-line invoice-line-discount">
                  <span>{discountLabel(i.discount_type, i.discount_value, i.discount_reason)}</span>
                  <span className="data-num">
                    −<Money amount={i.discount_amount} />
                  </span>
                </div>
              )}
            </li>
          ))}
          {invoice.discount_amount > 0 && (
            <li>
              <div className="invoice-line invoice-line-discount">
                <span>{discountLabel(invoice.discount_type, invoice.discount_value, invoice.discount_reason)}</span>
                <span className="data-num">
                  −<Money amount={invoice.discount_amount} />
                </span>
              </div>
            </li>
          )}
        </ul>

        <dl className="invoice-sums">
          <dt>{t('payments.netTotal')}</dt>
          <dd><Money amount={invoice.amount_total - invoice.vat_total} /></dd>
          <dt>
            {t('payments.vat')} {vatRate !== null && <Ltr>{`${vatRate}%`}</Ltr>}
          </dt>
          <dd><Money amount={invoice.vat_total} /></dd>
          <dt className="invoice-sums-total">{t('payments.total')}</dt>
          <dd className="invoice-sums-total"><Money amount={invoice.amount_total} /></dd>
          {invoice.amount_credited > 0 && (
            <>
              <dt>{t('payments.creditedAmount')}</dt>
              <dd>−<Money amount={invoice.amount_credited} /></dd>
              <dt>{t('payments.effectiveTotal')}</dt>
              <dd><Money amount={creditable} /></dd>
            </>
          )}
          <dt>{t('payments.paid')}</dt>
          <dd><Money amount={invoice.amount_paid - invoice.amount_refunded} /></dd>
          <dt>{t('payments.remaining')}</dt>
          <dd className="data-strong"><Money amount={remaining} /></dd>
        </dl>

        {invoice.invoice_payments.length > 0 && (
          <>
            <h3>{t('payments.payments')}</h3>
            <ul className="invoice-lines">
              {invoice.invoice_payments.map((p) => (
                <li key={p.id} className="invoice-line">
                  <span>
                    {t(METHOD_LABEL_KEYS[p.method])} <span className="data-muted"><Ltr>{formatDateTime(p.paid_at)}</Ltr></span>
                  </span>
                  <span className="data-num"><Money amount={p.amount} /></span>
                </li>
              ))}
            </ul>
          </>
        )}

        {invoice.credit_notes.length > 0 && (
          <>
            <h3>{t('payments.creditNotes')}</h3>
            <ul className="invoice-lines">
              {invoice.credit_notes.map((c) => (
                <li key={c.id} className="invoice-line">
                  <span>
                    <Ltr>{c.credit_number}</Ltr> <span className="data-muted">· {c.reason}</span>
                  </span>
                  <span className="invoice-line-end">
                    <span className="data-num">−<Money amount={c.amount} /></span>
                    <button type="button" className="secondary-button" onClick={() => printCredit(c)}>
                      {t('payments.print')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {!vatNumber && isManager && <p className="pet-owner">{t('payments.noVatNumberHint')}</p>}

        {mode === 'pay' && (
          <form className="pet-form invoice-action-form" onSubmit={handlePay}>
            {error && <p className="form-error">{error}</p>}
            <MethodToggle value={method} onChange={setMethod} />
            <label>
              {t('payments.amount')}
              <input type="number" inputMode="decimal" className="no-spinner" dir="ltr" min="0.01" step="0.01" max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
            <div className="record-edit-actions">
              <button type="submit" disabled={saving}>{saving ? t('common.saving') : t('payments.addPayment')}</button>
              <button type="button" className="cancel-button" onClick={() => setMode('view')}>{t('common.cancel')}</button>
            </div>
          </form>
        )}

        {mode === 'credit' && (
          <form className="pet-form invoice-action-form" onSubmit={handleCredit}>
            {error && <p className="form-error">{error}</p>}
            <fieldset className="invoice-credit-lines">
              <legend>{t('payments.creditLines')}</legend>
              {items.map((i) => (
                <label key={i.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    disabled={credited.has(i.id)}
                    checked={creditItems.includes(i.id)}
                    onChange={(e) => setCreditItems((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((id) => id !== i.id)))}
                  />
                  {i.description} · <Money amount={i.line_total - i.bill_discount_share} />
                </label>
              ))}
            </fieldset>
            <label>
              {t('payments.creditAmount')}
              <input type="number" inputMode="decimal" className="no-spinner" dir="ltr" min="0.01" step="0.01" max={creditable} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <span className="pet-owner">{t('payments.creditAmountHint', { amount: formatMoney(creditable) })}</span>
            </label>
            <label>
              {t('payments.discountReason')}
              <RequiredMark />
              <input value={reason} onChange={(e) => setReason(e.target.value)} required />
            </label>
            <div>
              <span className="pet-form-file-field-label">{t('payments.refundMethod')}</span>
              <MethodToggle value={method} onChange={setMethod} />
            </div>
            <div className="record-edit-actions">
              <button type="submit" disabled={saving}>{saving ? t('common.saving') : t('payments.issueCreditNote')}</button>
              <button type="button" className="cancel-button" onClick={() => setMode('view')}>{t('common.cancel')}</button>
            </div>
          </form>
        )}

        {mode === 'view' && (
          <div className="admin-modal-actions">
            {remaining > 0 && (
              <button type="button" className="primary-button" onClick={() => open('pay')}>
                {t('payments.addPayment')}
              </button>
            )}
            <button type="button" className="secondary-button" onClick={printThis}>
              {t('payments.print')}
            </button>
            {creditable > 0 && (
              <button type="button" className="secondary-button" onClick={() => open('credit')}>
                {t('payments.issueCreditNote')}
              </button>
            )}
            <button type="button" className="cancel-button" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default InvoiceDetail
