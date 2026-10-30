import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PageSkeleton } from '../components/Skeleton'
import { useRequestKey } from '../lib/requestKey'
import { useAuth } from '../lib/AuthContext'
import { useBranch, useBranchView } from '../lib/BranchContext'
import { ALL_BRANCHES } from '../lib/branchChoice'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import PetPicker from '../components/PetPicker'
import { usePet } from '../lib/usePet'
import Ltr from '../components/Ltr'
import RequiredMark from '../components/RequiredMark'
import BranchFilter from '../components/BranchFilter'
import PaymentStatusBadge from '../components/PaymentStatusBadge'
import InvoiceDetail from '../components/InvoiceDetail'
import { Trash2 } from 'lucide-react'
import { priceWithVat } from '../lib/vat'
import { stayNights } from '../lib/inpatient'
import { clinicDay, clinicMidnight, formatDate, formatDateTime, formatMoney } from '../lib/format'
import { clinicTimeToIso } from '../lib/timeOff'
import { toPaymentLines } from '../lib/visitServices'
import { matchesPetSearch } from '../lib/appointmentSearch'
import {
  INVOICE_SELECT,
  METHOD_LABEL_KEYS,
  balanceUsed,
  methodsFor,
  discountPercent,
  invoiceTotals,
  isDiscountValid,
} from '../lib/invoiceMath'
import type { Discount, InvoiceFull, PaymentMethod } from '../lib/invoiceMath'
import FormError from '../components/FormError'
import PaidAtField from '../components/PaidAtField'

type Service = Database['public']['Tables']['services']['Row']
type Appointment = Database['public']['Tables']['appointments']['Row']

// Loaded newest-first and capped — this is a history view, not an
// accounting export, so an older invoice simply drops off the search
// rather than the page ever fetching the clinic's entire lifetime ledger.
const INVOICE_HISTORY_LIMIT = 300

type DiscountDraft = { type: Discount['type']; value: string; reason: string }
type LineItem = { key: string; serviceId: string; description: string; unitPrice: string; quantity: string; discount: DiscountDraft | null }
// A blank amount means "the rest of the bill".
type PayRow = { key: string; method: PaymentMethod; amount: string }

const newDiscount = (): DiscountDraft => ({ type: 'percent', value: '', reason: '' })
const toDiscount = (d: DiscountDraft | null): Discount | null => (d ? { type: d.type, value: parseFloat(d.value), reason: d.reason.trim() } : null)

function newLineItem(): LineItem {
  return { key: crypto.randomUUID(), serviceId: '', description: '', unitPrice: '', quantity: '1', discount: null }
}

const newPayRow = (): PayRow => ({ key: crypto.randomUUID(), method: 'cash', amount: '' })

function PaymentsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { branchId, branchName } = useBranch()
  // The picked branch's invoices; managers may switch to another branch or all.
  const [viewBranch, setViewBranch] = useBranchView()
  // "Bill this visit" on the appointment dialog opens /payments?bill=<appointment id>.
  const [searchParams, setSearchParams] = useSearchParams()
  const billId = searchParams.get('bill')
  // From the pet file's "Take payment": start a bill for that pet.
  const forPetId = searchParams.get('pet')
  // From an owner's invoice list: open that invoice (fetched if older than the loaded history).
  const invoiceParam = searchParams.get('invoice')
  // From a discharged stay's 'Bill this stay' (0086): nights from the price list's hospital night.
  const stayParam = searchParams.get('stay')
  const isManager = profile?.clinic_role === 'manager'
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [services, setServices] = useState<Service[]>([])
  const [priceQuery, setPriceQuery] = useState('')
  const [invoices, setInvoices] = useState<InvoiceFull[]>([])
  const [todayPayments, setTodayPayments] = useState<{ method: string; amount: number }[]>([])
  const [clinic, setClinic] = useState<{ vat_number: string | null; tax_phase: string; max_staff_discount_percent: number } | null>(null)
  // 0100: a clinic that isn't VAT-registered shows no VAT anywhere.
  const vatOn = clinic?.tax_phase !== 'none'
  const [petAppointments, setPetAppointments] = useState<(Appointment & { invoice: { id: string } | null })[]>([])
  // The picked pet's owner's prepaid balance (0064); null = no pet picked.
  const [ownerBalance, setOwnerBalance] = useState<number | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const [petId, setPetId] = useState('')
  const invoiceKey = useRequestKey()
  const invoicePet = usePet(petId)
  const [appointmentId, setAppointmentId] = useState('')
  const [stay, setStay] = useState<{ id: string; admitted_at: string; discharged_at: string; noNightService: boolean } | null>(null)
  // Read by the visit auto-pick below, which runs in a promise after the pet changes.
  const billingStay = useRef(false)
  const [items, setItems] = useState<LineItem[]>([newLineItem()])
  const [billDiscount, setBillDiscount] = useState<DiscountDraft | null>(null)
  const [payRows, setPayRows] = useState<PayRow[]>([newPayRow()])
  // Empty = timed when Create invoice is pressed. Only managers may enter an earlier time (DB enforces it, 0066).
  const [paidAt, setPaidAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')

  useEffect(() => {
    async function load() {
      const dayStart = clinicMidnight() // clinic day, like the cash-up report
      let invoicesQuery = supabase.from('invoices').select(INVOICE_SELECT)
      let todayQuery = supabase.from('invoice_payments').select('method, amount').gte('paid_at', dayStart.toISOString())
      if (viewBranch !== ALL_BRANCHES) {
        invoicesQuery = invoicesQuery.eq('branch_id', viewBranch)
        todayQuery = todayQuery.eq('branch_id', viewBranch)
      }
      const [servicesRes, invoicesRes, todayRes, clinicRes] = await Promise.all([
        supabase.from('services').select('*').eq('active', true).order('name', { ascending: true }),
        invoicesQuery.order('created_at', { ascending: false }).limit(INVOICE_HISTORY_LIMIT),
        todayQuery,
        profile?.clinic_id
          ? supabase.from('clinics').select('vat_number, tax_phase, max_staff_discount_percent').eq('id', profile.clinic_id).single()
          : Promise.resolve({ data: null }),
      ])
      setServices(servicesRes.data ?? [])
      setInvoices((invoicesRes.data ?? []) as unknown as InvoiceFull[])
      setTodayPayments(todayRes.data ?? [])
      setClinic(clinicRes.data)
      setLoading(false)
    }
    load()
  }, [viewBranch, profile?.clinic_id])

  useEffect(() => {
    if (!invoiceParam) return
    supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('id', invoiceParam)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const invoice = data as InvoiceFull
          setInvoices((current) => (current.some((i) => i.id === invoice.id) ? current : [invoice, ...current]))
          setOpenId(invoice.id)
        }
        setSearchParams({}, { replace: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceParam])

  useEffect(() => {
    if (!forPetId) return
    setPetId(forPetId)
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forPetId])

  useEffect(() => {
    if (!stayParam) return
    setSearchParams({}, { replace: true })
    Promise.all([
      supabase.from('inpatient_stays').select('id, pet_id, admitted_at, discharged_at').eq('id', stayParam).maybeSingle(),
      supabase.from('services').select('*').eq('hospital_night', true).eq('active', true).maybeSingle(),
    ]).then(([stayRes, nightRes]) => {
      const row = stayRes.data
      if (!row?.discharged_at) return
      const night = nightRes.data
      billingStay.current = true
      setPetId(row.pet_id)
      setAppointmentId('')
      setStay({ id: row.id, admitted_at: row.admitted_at, discharged_at: row.discharged_at, noNightService: !night })
      setItems([
        {
          ...newLineItem(),
          serviceId: night?.id ?? '',
          description: night?.name ?? t('inpatient.nightLine'),
          unitPrice: night ? String(priceWithVat(night.price, night.vat_rate)) : '',
          quantity: String(stayNights(row.admitted_at, row.discharged_at)),
        },
        newLineItem(),
      ])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayParam])

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
      const lines = toPaymentLines(servicesRes.data ?? []).map((line) => ({ key: crypto.randomUUID(), discount: null, ...line }))
      setItems(lines.length > 0 ? lines : [newLineItem()])
    })
  }, [billId])

  // The appointment link is just a convenience for picking a recent visit
  // to attach the invoice to — not every invoice has one, so this stays
  // optional and resets whenever the pet is picked (see PetPicker below).
  // shortcut: only the pet's 10 latest visits are offered; a billed visit older than that shows as "no appointment" in the select but stays linked.
  const ownerFileId = invoicePet?.owner_file_id
  useEffect(() => {
    setOwnerBalance(null)
    if (!ownerFileId) return
    supabase
      .from('owner_balances')
      .select('balance')
      .eq('owner_file_id', ownerFileId)
      .maybeSingle()
      .then(({ data }) => setOwnerBalance(data?.balance ?? 0))
  }, [ownerFileId])

  useEffect(() => {
    if (!petId) {
      setPetAppointments([])
      return
    }
    supabase
      .from('appointments')
      .select('*, invoice:invoices!invoices_appointment_id_fkey(id)')
      .eq('pet_id', petId)
      .order('scheduled_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setPetAppointments(data ?? [])
        // Most bills are for today's visit: pick it unless one was chosen (e.g. "Bill this visit").
        const today = (data ?? []).find((a) => !a.invoice && a.status !== 'cancelled' && clinicDay(a.scheduled_at) === clinicDay())
        // A stay bill is not a visit bill: don't link (and so mark billed) today's visit.
        if (today && !billingStay.current) setAppointmentId((current) => current || today.id)
      })
  }, [petId])

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  function updateLineDiscount(key: string, patch: Partial<DiscountDraft>) {
    setItems((current) => current.map((item) => (item.key === key && item.discount ? { ...item, discount: { ...item.discount, ...patch } } : item)))
  }

  function handlePickService(key: string, serviceId: string) {
    const service = services.find((s) => s.id === serviceId)
    updateItem(key, {
      serviceId,
      description: service ? service.name : '',
      unitPrice: service ? String(priceWithVat(service.price, service.vat_rate)) : '',
    })
  }

  function removeItem(key: string) {
    setItems((current) => (current.length > 1 ? current.filter((item) => item.key !== key) : current))
  }

  function updatePayRow(key: string, patch: Partial<PayRow>) {
    setPayRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  // Same math as create_invoice() in the database; the database has the last word.
  const totals = useMemo(
    () =>
      invoiceTotals(
        items.map((item) => ({
          unitPrice: parseFloat(item.unitPrice) || 0,
          quantity: parseFloat(item.quantity) || 0,
          vatRate: vatOn ? (services.find((s) => s.id === item.serviceId)?.vat_rate ?? 15) : 0,
          discount: toDiscount(item.discount),
        })),
        toDiscount(billDiscount),
      ),
    [items, billDiscount, services, vatOn],
  )

  // Blank amounts take what the filled-in rows leave of the total (the first blank row only).
  const payments = useMemo(() => {
    const typed = payRows.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0)
    let rest = Math.max(0, Math.round((totals.total - typed) * 100) / 100)
    return payRows.map((row) => {
      if (row.amount.trim()) return { key: row.key, method: row.method, amount: parseFloat(row.amount) }
      const amount = rest
      rest = 0
      return { key: row.key, method: row.method, amount }
    })
  }, [payRows, totals.total])
  const rest = payments.find((_, i) => !payRows[i].amount.trim())?.amount ?? 0

  const maxDiscount = clinic?.max_staff_discount_percent ?? 10

  async function handleCreateInvoice(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!profile?.clinic_id) return

    if (!petId) {
      setFormError(t('payments.invalidPet'))
      return
    }

    const lines = items.filter((item) => item.description.trim())
    const itemsInvalid = lines.some((item) => {
      const price = parseFloat(item.unitPrice)
      const qty = parseFloat(item.quantity)
      return Number.isNaN(price) || price < 0 || !Number.isInteger(qty) || qty <= 0
    })
    if (lines.length === 0 || itemsInvalid) {
      setFormError(t('payments.invalidItems'))
      return
    }

    // Each discount with the base it applies to: its line, or the bill after line discounts.
    const discounts = items
      .map((item, i) => ({ d: toDiscount(item.discount), base: totals.rows[i].gross }))
      .concat({ d: toDiscount(billDiscount), base: totals.sum })
      .filter((x): x is { d: Discount; base: number } => x.d !== null)
    if (discounts.some((x) => !isDiscountValid(x.base, x.d))) {
      setFormError(t('payments.discountInvalid'))
      return
    }
    if (!isManager && discounts.some((x) => discountPercent(x.base, x.d) > maxDiscount)) {
      setFormError(t('payments.discountOverLimit', { max: String(maxDiscount) }))
      return
    }

    const paid = payments.filter((p) => p.amount !== 0)
    if (paid.some((p) => !(p.amount > 0))) {
      setFormError(t('payments.invalidAmount'))
      return
    }
    if (paid.reduce((sum, p) => sum + p.amount, 0) > totals.total + 0.001) {
      setFormError(t('payments.overpaid'))
      return
    }
    if (balanceUsed(paid) > (ownerBalance ?? 0)) {
      setFormError(t('owners.notEnoughBalance', { amount: `${formatMoney(ownerBalance ?? 0)} ${t('common.currency')}` }))
      return
    }

    setSaving(true)
    const { data: id, error } = await supabase.rpc('create_invoice', {
      p_pet: petId,
      p_branch: branchId,
      p_appointment: appointmentId || null,
      p_stay: stay?.id ?? null,
      p_notes: notes.trim() || null,
      p_lines: lines.map((item) => ({
        service_id: item.serviceId || null,
        description: item.description.trim(),
        unit_price: parseFloat(item.unitPrice),
        quantity: parseInt(item.quantity, 10),
        discount: toDiscount(item.discount),
      })),
      p_discount: toDiscount(billDiscount),
      p_payments: paid.map((p) => ({ method: p.method, amount: p.amount })),
      ...(isManager && paidAt ? { p_paid_at: clinicTimeToIso(...(paidAt.split('T') as [string, string])) } : {}),
      p_request: invoiceKey.current(),
    })

    if (error || !id) {
      setFormError(
        error?.message.includes('invoices_stay_id_key')
          ? t('inpatient.stayAlreadyBilled')
          : error?.code === '23505'
          ? t('payments.alreadyBilled')
          : error?.message.includes('staff limit')
            ? t('payments.discountOverLimit', { max: String(maxDiscount) })
            : error?.message.startsWith('Not enough balance')
              ? t('owners.notEnoughBalance', { amount: `${formatMoney(ownerBalance ?? 0)} ${t('common.currency')}` })
              : (error?.message ?? t('common.couldNotSave')),
      )
      setSaving(false)
      return
    }

    invoiceKey.renew()
    const { data: invoice } = await supabase.from('invoices').select(INVOICE_SELECT).eq('id', id).single()
    const created = invoice as unknown as InvoiceFull | null
    if (created) {
      // Saved to the picked branch: show that branch's list if another one is on screen.
      if (viewBranch !== ALL_BRANCHES && viewBranch !== created.branch_id) setViewBranch(created.branch_id)
      else setInvoices((current) => [created, ...current])
      setTodayPayments((current) => [...current, ...paid.map((p) => ({ method: p.method, amount: p.amount }))])
      setOpenId(created.id)
      toast.success(t('payments.invoiceCreated', { number: created.invoice_number }))
    }
    setPetId('')
    setAppointmentId('')
    billingStay.current = false
    setStay(null)
    if (billId) setSearchParams({}, { replace: true })
    setItems([newLineItem()])
    setBillDiscount(null)
    setPayRows([newPayRow()])
    setPaidAt('')
    setNotes('')
    setSaving(false)
  }

  const filteredInvoices = useMemo(() => {
    // Appending a local time-of-day before parsing — a bare "YYYY-MM-DD"
    // parses as UTC midnight per spec, which would shift the boundary by
    // the clinic's UTC offset (e.g. 3 hours early in Saudi Arabia).
    const fromIso = dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : null
    const toIso = dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : null
    const min = amountMin ? parseFloat(amountMin) : null
    const max = amountMax ? parseFloat(amountMax) : null
    const q = search.trim().toLowerCase()

    return invoices.filter((invoice) => {
      // Invoice number, or the pet: name, Pet ID or owner phone.
      if (q && !invoice.invoice_number.toLowerCase().includes(q) && !(invoice.pets && matchesPetSearch(invoice.pets, q))) return false
      if (fromIso && invoice.created_at < fromIso) return false
      if (toIso && invoice.created_at > toIso) return false
      if (min !== null && !Number.isNaN(min) && invoice.amount_total < min) return false
      if (max !== null && !Number.isNaN(max) && invoice.amount_total > max) return false
      return true
    })
  }, [invoices, search, dateFrom, dateTo, amountMin, amountMax])

  const todayTotals = useMemo(() => {
    const total = todayPayments.reduce((sum, p) => sum + p.amount, 0)
    const cash = todayPayments.filter((p) => p.method === 'cash').reduce((sum, p) => sum + p.amount, 0)
    const awaiting = invoices.filter((inv) => inv.payment_status !== 'paid').length
    return { total, cash, nonCash: total - cash, awaiting }
  }, [todayPayments, invoices])

  if (loading) return <PageSkeleton title={t('payments.title')} />

  const priceMatches = services.filter((s) => s.name.toLowerCase().includes(priceQuery.trim().toLowerCase()))
  const openInvoice = invoices.find((inv) => inv.id === openId) ?? null

  function discountFields(d: DiscountDraft, onChange: (patch: Partial<DiscountDraft>) => void, onRemove: () => void) {
    return (
      <div className="invoice-discount-row">
        <select value={d.type} onChange={(e) => onChange({ type: e.target.value as Discount['type'] })} aria-label={t('payments.discountType')}>
          <option value="percent">{t('payments.discountTypePercent')}</option>
          <option value="amount">{t('payments.discountTypeAmount')}</option>
        </select>
        <input
          type="number"
          inputMode="decimal"
          className="no-spinner"
          dir="ltr"
          min="0"
          step="0.01"
          value={d.value}
          onChange={(e) => onChange({ value: e.target.value })}
          aria-label={t('payments.discountValue')}
          placeholder={t('payments.discountValue')}
        />
        <input
          className="invoice-discount-reason"
          value={d.reason}
          onChange={(e) => onChange({ reason: e.target.value })}
          aria-label={t('payments.discountReason')}
          placeholder={t('payments.discountReason')}
        />
        <button type="button" className="delete-button invoice-item-remove" onClick={onRemove} aria-label={t('payments.removeDiscount')}>
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
    )
  }

  const money = (amount: number) => (
    <>
      <Ltr>{formatMoney(amount)}</Ltr> <span className="money-currency">{t('common.currency')}</span>
    </>
  )
  const anyDiscount = totals.bill > 0 || totals.rows.some((r) => r.discount > 0)

  return (
    <div>
      <div className="page-header">
        <h1>{t('payments.title')}</h1>
        {isManager && <BranchFilter value={viewBranch} onChange={setViewBranch} />}
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">{money(todayTotals.total)}</div>
          <div className="stat-label">{t('payments.todayTotal')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">{money(todayTotals.cash)}</div>
          <div className="stat-label">{t('payments.todayCash')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">{money(todayTotals.nonCash)}</div>
          <div className="stat-label">{t('payments.todayNonCash')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">{todayTotals.awaiting}</div>
          <div className="stat-label">{t('payments.awaitingPayment')}</div>
        </div>
      </div>

      {/* PC: new invoice beside the price lookup; stacked on smaller screens. */}
      <div className="payments-top">
        <div className="settings-section">
          <h2>{t('payments.newInvoice')}</h2>
          <form onSubmit={handleCreateInvoice} className="pet-form payments-record-form">
            <FormError message={formError} />

            <label>
              {t('payments.pet')}
              <RequiredMark />
              <PetPicker
                pet={invoicePet}
                value={petId}
                onChange={(id) => {
                  setPetId(id)
                  setAppointmentId('')
                  billingStay.current = false
                  setStay(null)
                }}
              />
            </label>
            {stay && (
              <p className="owner-balance-note">
                {t('inpatient.billForStay', { from: formatDate(stay.admitted_at), to: formatDate(stay.discharged_at), count: String(stayNights(stay.admitted_at, stay.discharged_at)) })}
              </p>
            )}
            {/* Nightly H24: without a hospital-night service the night line has no price. */}
            {stay?.noNightService && (
              <p className="owner-balance-note" role="status">
                {t('inpatient.noNightService')}{' '}
                {isManager ? <Link to="/settings">{t('inpatient.noNightServiceLink')}</Link> : t('inpatient.noNightServiceAsk')}
              </p>
            )}
            {ownerBalance !== null && (
              <p className="owner-balance-note">
                {t('owners.ownerBalance', { amount: `${formatMoney(ownerBalance)} ${t('common.currency')}` })}
              </p>
            )}

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
                <div key={item.key} className="invoice-item-block">
                  <div className="invoice-item-row">
                    <select value={item.serviceId} onChange={(e) => handlePickService(item.key, e.target.value)} aria-label={t('list.service')}>
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
                        aria-label={t('payments.itemDescription')}
                      />
                    )}
                    <input
                      type="number"
                      inputMode="numeric"
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
                      inputMode="decimal"
                      className="no-spinner invoice-item-price"
                      dir="ltr"
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })}
                      // Price-list lines always use the list price (0062); lower it with a discount.
                      readOnly={Boolean(item.serviceId)}
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
                  {item.discount ? (
                    discountFields(item.discount, (patch) => updateLineDiscount(item.key, patch), () => updateItem(item.key, { discount: null }))
                  ) : (
                    <button type="button" className="secondary-button invoice-discount-add" onClick={() => updateItem(item.key, { discount: newDiscount() })}>
                      + {t('payments.addDiscount')}
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="secondary-button" onClick={() => setItems((current) => [...current, newLineItem()])}>
                {t('payments.addItem')}
              </button>
            </div>

            <div className="invoice-items">
              <span className="pet-form-file-field-label">{t('payments.billDiscount')}</span>
              {billDiscount ? (
                discountFields(billDiscount, (patch) => setBillDiscount((d) => (d ? { ...d, ...patch } : d)), () => setBillDiscount(null))
              ) : (
                <button type="button" className="secondary-button invoice-discount-add" onClick={() => setBillDiscount(newDiscount())}>
                  + {t('payments.addDiscount')}
                </button>
              )}
              {!isManager && (items.some((i) => i.discount) || billDiscount) && (
                <p className="pet-owner">{t('payments.discountLimitHint', { max: String(maxDiscount) })}</p>
              )}
            </div>

            <dl className="invoice-sums">
              {anyDiscount && (
                <>
                  <dt>{t('payments.subtotal')}</dt>
                  <dd>{money(totals.rows.reduce((s, r) => s + r.gross, 0))}</dd>
                  <dt>{t('payments.discounts')}</dt>
                  <dd>{money(-(totals.bill + totals.rows.reduce((s, r) => s + r.discount, 0)))}</dd>
                </>
              )}
              {vatOn && (
                <>
                  <dt>{t('payments.netTotal')}</dt>
                  <dd>{money(totals.net)}</dd>
                  <dt>{t('payments.vat')}</dt>
                  <dd>{money(totals.vat)}</dd>
                </>
              )}
              <dt className="invoice-sums-total">{t('payments.total')}</dt>
              <dd className="invoice-sums-total">{money(totals.total)}</dd>
            </dl>

            <div className="invoice-items">
              <span className="pet-form-file-field-label">{t('payments.payments')}</span>
              {payRows.length === 0 && <p className="pet-owner">{t('payments.noPaymentYet')}</p>}
              {payRows.map((row, i) => (
                <div key={row.key} className="invoice-pay-row">
                  <div className="method-toggle" role="group" aria-label={t('payments.method')}>
                    {methodsFor(ownerBalance).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={row.method === m}
                        className={`secondary-button${row.method === m ? ' method-toggle-active' : ''}`}
                        onClick={() =>
                          // Paying from balance: take what it can cover of this row (P1), not more than it holds.
                          updatePayRow(
                            row.key,
                            m === 'balance' && ownerBalance !== null
                              ? { method: m, amount: Math.min(ownerBalance, payments[i]?.amount ?? 0).toFixed(2) }
                              : { method: m },
                          )
                        }
                      >
                        {t(METHOD_LABEL_KEYS[m])}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="no-spinner"
                    dir="ltr"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    onChange={(e) => updatePayRow(row.key, { amount: e.target.value })}
                    placeholder={t('payments.restPlaceholder', { amount: formatMoney(rest) })}
                    aria-label={t('payments.amount')}
                  />
                  <button
                    type="button"
                    className="delete-button invoice-item-remove"
                    onClick={() => setPayRows((current) => current.filter((r) => r.key !== row.key))}
                    aria-label={t('common.delete')}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                  {row.method === 'balance' && ownerBalance !== null && (
                    <span className="invoice-pay-row-note">
                      {t('owners.ownerBalance', { amount: `${formatMoney(ownerBalance)} ${t('common.currency')}` })}
                    </span>
                  )}
                </div>
              ))}
              <button type="button" className="secondary-button" onClick={() => setPayRows((current) => [...current, newPayRow()])}>
                + {t(payRows.length ? 'payments.splitPayment' : 'payments.addPaymentPart')}
              </button>
            </div>

            {isManager && payRows.length > 0 && (
              <PaidAtField value={paidAt} onChange={setPaidAt} />
            )}

            <label>
              {t('payments.notes')}
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? t('common.saving') : t('payments.createInvoice')}
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
          {vatOn && <p className="price-lookup-note">{t('payments.pricesIncludeVat')}</p>}
        </div>
      </div>

      <div className="settings-section">
        <h2>{t('payments.history')}</h2>
        <input
          type="search"
          className="search-input payments-search"
          placeholder={t('payments.search')}
          aria-label={t('payments.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
            <input type="number" className="no-spinner" dir="ltr" min="0" step="0.01" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
          </label>
          <label>
            {t('payments.filterAmountMax')}
            <input type="number" className="no-spinner" dir="ltr" min="0" step="0.01" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
          </label>
        </div>

        {filteredInvoices.length === 0 ? (
          <p className="empty-state">{invoices.length === 0 ? t('payments.noInvoicesYet') : t('payments.noneMatch')}</p>
        ) : (
          <ul className="pet-list data-table data-payments">
            <li className="data-head" aria-hidden>
              <span>{t('payments.invoiceNumber')}</span>
              <span>{t('list.pet')}</span>
              <span className="data-num">{t('list.amount')}</span>
              <span>{t('list.status')}</span>
              <span>{t('payments.date')}</span>
              <span />
            </li>
            {filteredInvoices.map((invoice) => (
              <li key={invoice.id} className="pet-list-item">
                <div className="pet-row data-row">
                  <span className="data-strong">
                    <Ltr>{invoice.invoice_number}</Ltr>
                  </span>
                  <span className="data-cell-wide">
                    <strong className="data-strong">{invoice.pets?.name ?? invoice.pet_name ?? '—'}</strong>
                    {(invoice.pets?.pet_number ?? invoice.pet_number) && (
                      <div className="pet-owner">
                        {t('pets.petId')}: <Ltr>{invoice.pets?.pet_number ?? invoice.pet_number}</Ltr>
                      </div>
                    )}
                  </span>
                  <span className="data-num data-strong">
                    {money(invoice.amount_total)}
                    {invoice.amount_credited > 0 && (
                      <div className="pet-owner">
                        {t('payments.creditedAmount')} <Ltr>{formatMoney(-invoice.amount_credited)}</Ltr>
                      </div>
                    )}
                  </span>
                  <span>
                    <PaymentStatusBadge status={invoice.payment_status} />
                  </span>
                  <span className="data-muted">
                    <Ltr>{formatDateTime(invoice.created_at)}</Ltr>
                  </span>
                  <div className="record-actions data-end">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setOpenId(invoice.id)}
                      aria-label={t('payments.openInvoice', { number: invoice.invoice_number, pet: invoice.pets?.name ?? invoice.pet_name ?? '—' })}
                    >
                      {t('payments.open')}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openInvoice && (
        <InvoiceDetail
          invoice={openInvoice}
          branchName={branchName(openInvoice.branch_id)}
          vatNumber={clinic?.vat_number ?? null}
          isManager={isManager}
          branchId={branchId}
          onChanged={(updated) => setInvoices((current) => current.map((inv) => (inv.id === updated.id ? updated : inv)))}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

export default PaymentsPage
