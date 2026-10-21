import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch, useBranchView } from '../lib/BranchContext'
import { ALL_BRANCHES } from '../lib/branchChoice'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import { useToast } from '../lib/ToastContext'
import { useConfirm } from '../lib/ConfirmContext'
import type { Database } from '../lib/database.types'
import PetPicker from '../components/PetPicker'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import RequiredMark from '../components/RequiredMark'
import BranchFilter from '../components/BranchFilter'
import { Trash2 } from 'lucide-react'
import { priceWithVat } from '../lib/vat'
import { formatDateTime, formatMoney } from '../lib/format'
import { toPaymentLines } from '../lib/visitServices'

type Pet = Database['public']['Tables']['pets']['Row']
type Service = Database['public']['Tables']['services']['Row']
type Appointment = Database['public']['Tables']['appointments']['Row']
type Invoice = Database['public']['Tables']['invoices']['Row'] & { pets: { name: string; pet_number: number } | null }

const PAYMENT_METHODS = ['cash', 'card', 'apple_pay'] as const
type PaymentMethod = (typeof PAYMENT_METHODS)[number]

const METHOD_LABEL_KEYS: Record<PaymentMethod, TranslationKey> = {
  cash: 'payments.methodCash',
  card: 'payments.methodCard',
  apple_pay: 'payments.methodApplePay',
}

// Loaded newest-first and capped — this is a history view, not an
// accounting export, so an older invoice simply drops off the search
// rather than the page ever fetching the clinic's entire lifetime ledger.
const INVOICE_HISTORY_LIMIT = 300

type LineItem = { key: string; serviceId: string; description: string; unitPrice: string; quantity: string }

function newLineItem(): LineItem {
  return { key: crypto.randomUUID(), serviceId: '', description: '', unitPrice: '', quantity: '1' }
}

function toLocalDateTimeInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function PaymentsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { branchId } = useBranch()
  // The picked branch's payments; managers may switch to another branch or all.
  const [viewBranch, setViewBranch] = useBranchView()
  const toast = useToast()
  const confirm = useConfirm()
  // "Bill this visit" on the appointment dialog opens /payments?bill=<appointment id>.
  const [searchParams, setSearchParams] = useSearchParams()
  const billId = searchParams.get('bill')

  const [loading, setLoading] = useState(true)
  const [pets, setPets] = useState<Pet[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [priceQuery, setPriceQuery] = useState('')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [petAppointments, setPetAppointments] = useState<Appointment[]>([])

  const [petId, setPetId] = useState('')
  const [appointmentId, setAppointmentId] = useState('')
  const [items, setItems] = useState<LineItem[]>([newLineItem()])
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paidAt, setPaidAt] = useState(() => toLocalDateTimeInput(new Date().toISOString()))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [verifyAmount, setVerifyAmount] = useState('')
  const [verifyPaidAt, setVerifyPaidAt] = useState('')
  const [savingVerifyId, setSavingVerifyId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')

  useEffect(() => {
    async function load() {
      let invoicesQuery = supabase.from('invoices').select('*, pets(name, pet_number)')
      if (viewBranch !== ALL_BRANCHES) invoicesQuery = invoicesQuery.eq('branch_id', viewBranch)
      const [petsRes, servicesRes, invoicesRes] = await Promise.all([
        supabase.from('pets').select('*').is('deleted_at', null).order('name', { ascending: true }),
        supabase.from('services').select('*').eq('active', true).order('name', { ascending: true }),
        invoicesQuery.order('paid_at', { ascending: false }).limit(INVOICE_HISTORY_LIMIT),
      ])
      setPets(petsRes.data ?? [])
      setServices(servicesRes.data ?? [])
      setInvoices((invoicesRes.data ?? []) as Invoice[])
      setLoading(false)
    }
    load()
  }, [viewBranch])

  // Pre-fill the form from the visit: its pet, the visit link and one line per service.
  useEffect(() => {
    if (!billId) return
    Promise.all([
      supabase.from('appointments').select('pet_id').eq('id', billId).maybeSingle(),
      supabase.from('appointment_services').select('*').eq('appointment_id', billId).order('created_at', { ascending: true }),
    ]).then(([apptRes, servicesRes]) => {
      if (!apptRes.data) return
      setPetId(apptRes.data.pet_id)
      setAppointmentId(billId)
      const lines = toPaymentLines(servicesRes.data ?? []).map((line) => ({ key: crypto.randomUUID(), ...line }))
      setItems(lines.length > 0 ? lines : [newLineItem()])
    })
  }, [billId])

  // The appointment link is just a convenience for picking a recent visit
  // to attach the payment to — not every payment has one, so this stays
  // optional and resets whenever the pet is picked (see PetPicker below).
  // shortcut: only the pet's 10 latest visits are offered; a billed visit older than that shows as "no appointment" in the select but stays linked.
  useEffect(() => {
    if (!petId) {
      setPetAppointments([])
      return
    }
    supabase
      .from('appointments')
      .select('*')
      .eq('pet_id', petId)
      .order('scheduled_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setPetAppointments(data ?? []))
  }, [petId])

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  function handlePickService(key: string, serviceId: string) {
    const service = services.find((s) => s.id === serviceId)
    updateItem(key, {
      serviceId,
      description: service ? service.name : '',
      unitPrice: service ? String(priceWithVat(service.price, service.vat_rate)) : '',
    })
  }

  function addItem() {
    setItems((current) => [...current, newLineItem()])
  }

  function removeItem(key: string) {
    setItems((current) => (current.length > 1 ? current.filter((item) => item.key !== key) : current))
  }

  const amountTotal = useMemo(
    () =>
      items.reduce((sum, item) => {
        const price = parseFloat(item.unitPrice)
        const qty = parseFloat(item.quantity)
        if (Number.isNaN(price) || Number.isNaN(qty)) return sum
        return sum + price * qty
      }, 0),
    [items],
  )

  async function handleCreateInvoice(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!profile?.clinic_id) return

    if (!petId) {
      setFormError(t('payments.invalidPet'))
      return
    }

    const cleanItems = items
      .filter((item) => item.description.trim())
      .map((item) => ({
        description: item.description.trim(),
        unitPrice: parseFloat(item.unitPrice),
        quantity: parseFloat(item.quantity) || 1,
        serviceId: item.serviceId || null,
      }))

    const itemsInvalid = cleanItems.some(
      (item) => Number.isNaN(item.unitPrice) || item.unitPrice < 0 || item.quantity <= 0,
    )
    if (cleanItems.length === 0 || itemsInvalid) {
      setFormError(t('payments.invalidItems'))
      return
    }

    setSaving(true)
    const total = cleanItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    // Cash has no paper trail to check afterward, so it's trusted and
    // marked verified the moment it's counted; card/Apple Pay stay
    // 'recorded' until someone checks the amount and time against the
    // terminal slip (see the verify flow below).
    const isCash = method === 'cash'
    const nowIso = new Date().toISOString()

    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert({
        clinic_id: profile.clinic_id,
        pet_id: petId,
        appointment_id: appointmentId || null,
        created_by: profile.id,
        method,
        status: isCash ? 'verified' : 'recorded',
        amount_total: total,
        paid_at: new Date(paidAt).toISOString(),
        notes: notes.trim() || null,
        verified_by: isCash ? profile.id : null,
        verified_at: isCash ? nowIso : null,
        // No branch picked (clinic without one): a DB trigger fills the main branch; the generated type can't know that.
        ...(branchId ? { branch_id: branchId } : {}),
      } as Database['public']['Tables']['invoices']['Insert'])
      .select('*, pets(name, pet_number)')
      .single()

    if (error || !invoice) {
      setFormError(error?.code === '23505' ? t('payments.alreadyBilled') : (error?.message ?? t('common.couldNotSave')))
      setSaving(false)
      return
    }

    const { error: itemsError } = await supabase.from('invoice_items').insert(
      cleanItems.map((item) => ({
        invoice_id: invoice.id,
        service_id: item.serviceId,
        description: item.description,
        unit_price: item.unitPrice,
        quantity: item.quantity,
        line_total: item.unitPrice * item.quantity,
      })),
    )
    if (itemsError) toast.error(itemsError.message)

    // Saved to the picked branch: show that branch's list if another one is on screen.
    if (viewBranch !== ALL_BRANCHES && viewBranch !== invoice.branch_id) setViewBranch(invoice.branch_id)
    else setInvoices((current) => [invoice as Invoice, ...current])
    toast.success(t('payments.recorded'))
    setPetId('')
    setAppointmentId('')
    if (billId) setSearchParams({}, { replace: true })
    setItems([newLineItem()])
    setMethod('cash')
    setPaidAt(toLocalDateTimeInput(new Date().toISOString()))
    setNotes('')
    setSaving(false)
  }

  function startVerify(invoice: Invoice) {
    setVerifyingId(invoice.id)
    setVerifyAmount(String(invoice.amount_total))
    setVerifyPaidAt(toLocalDateTimeInput(invoice.paid_at))
  }

  async function handleSaveVerify(invoice: Invoice) {
    const amount = parseFloat(verifyAmount)
    if (Number.isNaN(amount) || amount < 0) {
      toast.error(t('payments.invalidAmount'))
      return
    }
    setSavingVerifyId(invoice.id)
    const { data, error } = await supabase
      .from('invoices')
      .update({
        amount_total: amount,
        paid_at: new Date(verifyPaidAt).toISOString(),
        status: 'verified',
        verified_by: profile?.id,
        verified_at: new Date().toISOString(),
      })
      .eq('id', invoice.id)
      .select('*, pets(name, pet_number)')
      .single()
    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      setSavingVerifyId(null)
      return
    }
    setInvoices((current) => current.map((inv) => (inv.id === data.id ? (data as Invoice) : inv)))
    setVerifyingId(null)
    setSavingVerifyId(null)
  }

  async function handleDeleteInvoice(invoice: Invoice) {
    const ok = await confirm(t('payments.deleteConfirm'), { danger: true, confirmLabel: t('common.delete') })
    if (!ok) return

    setDeletingId(invoice.id)
    const { error } = await supabase.from('invoices').delete().eq('id', invoice.id)
    if (error) {
      toast.error(error.message)
      setDeletingId(null)
      return
    }
    setInvoices((current) => current.filter((inv) => inv.id !== invoice.id))
    setDeletingId(null)
  }

  const filteredInvoices = useMemo(() => {
    // Appending a local time-of-day before parsing — a bare "YYYY-MM-DD"
    // parses as UTC midnight per spec, which would shift the boundary by
    // the clinic's UTC offset (e.g. 3 hours early in Saudi Arabia).
    const fromIso = dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : null
    const toIso = dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : null
    const min = amountMin ? parseFloat(amountMin) : null
    const max = amountMax ? parseFloat(amountMax) : null

    return invoices.filter((invoice) => {
      if (fromIso && invoice.paid_at < fromIso) return false
      if (toIso && invoice.paid_at > toIso) return false
      if (min !== null && !Number.isNaN(min) && invoice.amount_total < min) return false
      if (max !== null && !Number.isNaN(max) && invoice.amount_total > max) return false
      return true
    })
  }, [invoices, dateFrom, dateTo, amountMin, amountMax])

  const todayTotals = useMemo(() => {
    const todayStr = new Date().toDateString()
    const todays = invoices.filter((inv) => new Date(inv.paid_at).toDateString() === todayStr)
    const total = todays.reduce((sum, inv) => sum + inv.amount_total, 0)
    const cash = todays.filter((inv) => inv.method === 'cash').reduce((sum, inv) => sum + inv.amount_total, 0)
    const unverified = invoices.filter((inv) => inv.status === 'recorded').length
    return { total, cash, nonCash: total - cash, unverified }
  }, [invoices])

  if (loading) return <LoadingScreen />

  const priceMatches = services.filter((s) => s.name.toLowerCase().includes(priceQuery.trim().toLowerCase()))

  return (
    <div>
      <div className="page-header">
        <h1>{t('payments.title')}</h1>
        {profile?.clinic_role === 'manager' && <BranchFilter value={viewBranch} onChange={setViewBranch} />}
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">
            <Ltr>{formatMoney(todayTotals.total)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
          </div>
          <div className="stat-label">{t('payments.todayTotal')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">
            <Ltr>{formatMoney(todayTotals.cash)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
          </div>
          <div className="stat-label">{t('payments.todayCash')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">
            <Ltr>{formatMoney(todayTotals.nonCash)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
          </div>
          <div className="stat-label">{t('payments.todayNonCash')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">
            {todayTotals.unverified}
          </div>
          <div className="stat-label">{t('payments.unverifiedCount')}</div>
        </div>
      </div>

      {/* PC: record payment beside the price lookup; stacked on smaller screens. */}
      <div className="payments-top">
      <div className="settings-section">
        <h2>{t('payments.recordPayment')}</h2>
        <form onSubmit={handleCreateInvoice} className="pet-form payments-record-form">
          {formError && <p className="form-error">{formError}</p>}

          <label>
            {t('payments.pet')}
            <RequiredMark />
            <PetPicker
              pets={pets}
              value={petId}
              onChange={(id) => {
                setPetId(id)
                setAppointmentId('')
              }}
            />
          </label>

          {petId && petAppointments.length > 0 && (
            <label>
              {t('payments.appointment')}
              <select value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
                <option value="">{t('payments.noAppointment')}</option>
                {petAppointments.map((appt) => (
                  <option key={appt.id} value={appt.id}>
                    {formatDateTime(appt.scheduled_at)}
                    {appt.reason ? ` — ${appt.reason}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="invoice-items">
            <span className="pet-form-file-field-label">{t('payments.items')}</span>
            <div className="invoice-item-head" aria-hidden>
              <span>{t('list.service')}</span>
              <span>{t('payments.quantity')}</span>
              <span>{t('payments.unitPrice')}</span>
              <span />
            </div>
            {items.map((item) => (
              <div key={item.key} className="invoice-item-row">
                <select value={item.serviceId} onChange={(e) => handlePickService(item.key, e.target.value)}>
                  <option value="">{t('payments.customItem')}</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} — {formatMoney(priceWithVat(service.price, service.vat_rate))} {t('common.currency')}
                    </option>
                  ))}
                </select>
                {!item.serviceId && (
                  <input
                    className="invoice-item-desc"
                    value={item.description}
                    onChange={(e) => updateItem(item.key, { description: e.target.value })}
                    placeholder={t('payments.itemDescription')}
                  />
                )}
                <input
                  type="number"
                  className="no-spinner invoice-item-qty"
                  dir="ltr"
                  min="1"
                  step="1"
                  value={item.quantity}
                  onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                  aria-label={t('payments.quantity')}
                />
                <input
                  type="number"
                  className="no-spinner invoice-item-price"
                  dir="ltr"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })}
                  aria-label={t('payments.unitPrice')}
                />
                <button
                  type="button"
                  className="delete-button invoice-item-remove"
                  onClick={() => removeItem(item.key)}
                  disabled={items.length === 1}
                  aria-label={t('common.delete')}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            ))}
            <button type="button" className="secondary-button" onClick={addItem}>
              {t('payments.addItem')}
            </button>
          </div>

          <label>
            {t('payments.method')}
            <div className="method-toggle">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`secondary-button${method === m ? ' method-toggle-active' : ''}`}
                  onClick={() => setMethod(m)}
                >
                  {t(METHOD_LABEL_KEYS[m])}
                </button>
              ))}
            </div>
          </label>

          <label>
            {t('payments.paidAt')}
            <input type="datetime-local" dir="ltr" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
          </label>

          <label>
            {t('payments.notes')}
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <p className="invoice-total">
            {t('payments.total')}: <Ltr>{formatMoney(amountTotal)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
          </p>

          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? t('common.saving') : t('payments.recordPayment')}
          </button>
        </form>
      </div>

      {/* Front desk quotes prices from here; Settings may become manager-only. */}
      <div className="settings-section">
        <h2>{t('payments.priceLookup')}</h2>
        <input
          type="search"
          className="search-input"
          placeholder={t('payments.priceLookupPlaceholder')}
          aria-label={t('payments.priceLookup')}
          value={priceQuery}
          onChange={(e) => setPriceQuery(e.target.value)}
        />
        {priceQuery.trim() &&
          (priceMatches.length === 0 ? (
            <p className="price-lookup-empty">{t('payments.noServiceMatch')}</p>
          ) : (
            <ul className="price-list">
              {priceMatches.map((service) => (
                <li key={service.id}>
                  <span>{service.name}</span>
                  <strong>
                    <Ltr>{formatMoney(priceWithVat(service.price, service.vat_rate))}</Ltr> {t('common.currency')}
                  </strong>
                </li>
              ))}
            </ul>
          ))}
        <p className="price-lookup-note">{t('payments.pricesIncludeVat')}</p>
      </div>

      </div>

      <div className="settings-section">
        <h2>{t('payments.history')}</h2>
        <div className="payments-filters">
          <label>
            {t('payments.filterFrom')}
            <input type="date" dir="ltr" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            {t('payments.filterTo')}
            <input type="date" dir="ltr" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label>
            {t('payments.filterAmountMin')}
            <input
              type="number"
              className="no-spinner"
              dir="ltr"
              min="0"
              step="0.01"
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
            />
          </label>
          <label>
            {t('payments.filterAmountMax')}
            <input
              type="number"
              className="no-spinner"
              dir="ltr"
              min="0"
              step="0.01"
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
            />
          </label>
        </div>

        {filteredInvoices.length === 0 ? (
          <p>{t('payments.noneMatch')}</p>
        ) : (
          <ul className="pet-list data-table data-payments">
            <li className="data-head" aria-hidden>
              <span>{t('list.pet')}</span>
              <span className="data-num">{t('list.amount')}</span>
              <span>{t('list.method')}</span>
              <span>{t('list.paidAt')}</span>
              <span>{t('list.status')}</span>
              <span />
            </li>
            {filteredInvoices.map((invoice) => (
              <li key={invoice.id} className="pet-list-item">
                {verifyingId === invoice.id ? (
                  <div className="pet-row">
                    <div className="service-edit-fields">
                      <input
                        type="number"
                        className="no-spinner"
                        dir="ltr"
                        min="0"
                        step="0.01"
                        value={verifyAmount}
                        onChange={(e) => setVerifyAmount(e.target.value)}
                      />
                      <input
                        type="datetime-local"
                        dir="ltr"
                        value={verifyPaidAt}
                        onChange={(e) => setVerifyPaidAt(e.target.value)}
                      />
                    </div>
                    <div className="record-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleSaveVerify(invoice)}
                        disabled={savingVerifyId === invoice.id}
                      >
                        {savingVerifyId === invoice.id ? t('common.saving') : t('payments.markVerified')}
                      </button>
                      <button type="button" className="secondary-button" onClick={() => setVerifyingId(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pet-row data-row">
                    <span className="data-cell-wide">
                      <strong className="data-strong">{invoice.pets?.name ?? '—'}</strong>
                      {invoice.pets && (
                        <div className="pet-owner">
                          {t('pets.petId')}: <Ltr>{invoice.pets.pet_number}</Ltr>
                        </div>
                      )}
                    </span>
                    <span className="data-num data-strong">
                      <Ltr>{formatMoney(invoice.amount_total)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
                    </span>
                    <span className="data-muted">{t(METHOD_LABEL_KEYS[invoice.method as PaymentMethod])}</span>
                    <span className="data-muted">
                      <Ltr>{formatDateTime(invoice.paid_at)}</Ltr>
                    </span>
                    <span>
                      <span className={`status-badge status-${invoice.status === 'verified' ? 'completed' : 'requested'}`}>
                        {t(invoice.status === 'verified' ? 'payments.statusVerified' : 'payments.statusRecorded')}
                      </span>
                    </span>
                    <div className="record-actions data-end">
                      {invoice.status === 'recorded' && (
                        <>
                          <button type="button" className="secondary-button" onClick={() => startVerify(invoice)}>
                            {t('payments.verify')}
                          </button>
                          <button
                            type="button"
                            className="delete-button"
                            onClick={() => handleDeleteInvoice(invoice)}
                            disabled={deletingId === invoice.id}
                          >
                            {deletingId === invoice.id ? t('common.saving') : t('common.delete')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default PaymentsPage
