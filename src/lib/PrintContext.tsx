import { createContext, useCallback, useContext } from 'react'
import type { ReactNode } from 'react'
import { useLanguage } from './i18n/LanguageContext'
import { translations } from './i18n/translations'
import type { TranslationKey } from './i18n/translations'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { visitRecordFields } from './clinicalFields'
import { signPhotoUrl } from './photoUrl'
import type { VisitRecordFields } from './clinicalFields'
import { formatDate, formatDateTime, formatMoney } from './format'
import { clinicLogoUrl } from './imageUpload'
import { zatcaTlvBase64 } from './zatcaQr'
import qrcode from 'qrcode-generator'

/** An invoice, credit note or balance deposit receipt, ready to print. Amounts are VAT-inclusive. */
export type InvoiceDoc = {
  kind: 'invoice' | 'credit_note' | 'deposit'
  number: string
  /** Credit note: the invoice it corrects. */
  invoiceNumber?: string
  date: string
  branch: string
  vatNumber: string | null
  pet: { name: string; number: number } | null
  lines: { description: string; quantity: number; unitPrice: number; total: number; discount?: { label: string; amount: number } }[]
  billDiscount?: { label: string; amount: number }
  total: number
  vat: number
  /** One rate for every line, or null when they differ. */
  vatRate: number | null
  payments?: { method: TranslationKey; amount: number; paidAt: string }[]
  paid?: number
  credited?: number
  remaining?: number
  reason?: string
  refund?: { method: TranslationKey; amount: number }
  /** Deposit: whose balance, and what it is after. */
  owner?: string
  balanceAfter?: number
}

export type VisitSummary = {
  date: string
  visitType?: string
  doctor?: string | null
  /** Owner name and phone, printed under the pet (single summary only). */
  owner?: string | null
  record: VisitRecordFields
  // Omitted entirely (not just falsy) when the caller's "include photo"
  // checkbox is unchecked — see PetDetail / AppointmentsPage print buttons.
  photoUrl?: string | null
}

/** A report: titled tables of ready-formatted cells; `num` marks right-aligned LTR columns. */
export type ReportDoc = {
  title: string
  meta: string[]
  sections: { title?: string; head: string[]; num: boolean[]; rows: string[][]; foot?: string[] }[]
  note?: string
}

export type WaiverDoc = {
  language: 'en' | 'ar'
  title: string
  body: string
  petName: string
  petNumber: number | null
  signerName: string
  signedAt: string
  collectedBy: string
  branch: string
  signature: string
  voided?: { at: string; by: string; reason: string }
}

type PrintContextValue = {
  printWaiver: (doc: WaiverDoc) => void
  printInvoice: (doc: InvoiceDoc) => void
  printReport: (doc: ReportDoc) => void
  printSummary: (petName: string, visit: VisitSummary, petNumber?: number) => void
  printHistory: (petName: string, visits: VisitSummary[], petNumber?: number) => void
}

const PrintContext = createContext<PrintContextValue | null>(null)

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2.5rem 2.5rem 4rem;
    color: #000;
    background: #fff;
    font-size: 14px;
    line-height: 1.5;
    font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
  }
  .print-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 3px solid #b8860b;
    margin: 0 0 1.75rem;
    padding: 0 0 1rem;
  }
  .print-header h1 { margin: 0; font-size: 1.7rem; letter-spacing: -0.01em; color: #000; }
  .print-header p { margin: 0.25rem 0 0; font-size: 0.95rem; color: #000; text-transform: uppercase; letter-spacing: 0.06em; }
  .print-clinic-phone { text-transform: none !important; letter-spacing: normal !important; color: #666 !important; font-size: 0.85rem !important; }
  .print-printed-at { font-size: 0.78rem; color: #888; white-space: nowrap; }
  .print-hero { display: flex; align-items: baseline; justify-content: space-between; gap: 1.5rem; margin: 0 0 1rem; }
  .print-hero-name { font-size: 2.6rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
  .print-hero-date { font-size: 1.4rem; font-weight: 600; color: #444; white-space: nowrap; }
  .print-hero-id { font-size: 0.95rem; color: #666; margin-top: 0.25rem; }
  .print-badge {
    display: inline-block; margin: 0 0 1.75rem; padding: 0.3rem 0.9rem;
    border: 1.5px solid #b8860b; border-radius: 999px; color: #8a6408;
    font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .print-fields { display: flex; flex-direction: column; gap: 1.5rem; }
  .print-field { border-inline-start: 3px solid #d8d2c4; padding-inline-start: 1rem; }
  .print-field-label { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8474; margin: 0 0 0.3rem; }
  .print-field-value { font-size: 1.05rem; line-height: 1.55; white-space: pre-wrap; }
  .print-history-entry { padding: 1.25rem 0; border-top: 1px solid #e2ddd0; break-inside: avoid; }
  .print-history-entry:first-of-type { border-top: none; padding-top: 0; }
  .print-history-entry-header { display: flex; align-items: center; gap: 0.75rem; margin: 0 0 1rem; }
  .print-history-entry-header .print-badge { margin: 0; }
  .print-history-date { font-size: 1.1rem; font-weight: 700; }
  .print-footer { margin-top: 3rem; padding-top: 0.75rem; border-top: 1px solid #ddd; font-size: 0.78rem; color: #999; text-align: center; }
  .print-photo { margin: 1rem 0 0; break-inside: avoid; }
  .print-photo img { max-width: 100%; max-height: 320px; object-fit: contain; border-radius: 6px; }
`

function fieldsHtml(t: (key: TranslationKey) => string, visit: VisitSummary) {
  return `
    <div class="print-fields">
      ${visitRecordFields(visit.record)
        .map(
          (field) => `<div class="print-field">
               <div class="print-field-label">${escapeHtml(t(field.labelKey))}</div>
               <div class="print-field-value">${escapeHtml(field.value)}</div>
             </div>`,
        )
        .join('')}
    </div>
    ${visit.photoUrl ? `<div class="print-photo"><img src="${escapeHtml(visit.photoUrl)}" alt="" /></div>` : ''}
  `
}

function buildDocument(
  t: (key: TranslationKey) => string,
  clinicLabel: string,
  clinicPhone: string | null,
  petName: string,
  visits: VisitSummary[],
  petNumber?: number,
) {
  const isHistory = visits.length > 1
  const title = isHistory ? t('printSummary.historyTitle') : t('printSummary.title')

  const body = isHistory
    ? visits
        .map(
          (visit) => `
            <div class="print-history-entry">
              <div class="print-history-entry-header">
                <span class="print-history-date">${escapeHtml(formatDate(visit.date))}</span>
                ${visit.visitType ? `<span class="print-badge">${escapeHtml(visit.visitType)}</span>` : ''}
                ${visit.doctor ? `<span class="print-hero-id">${escapeHtml(t('printSummary.doctor'))}: ${escapeHtml(visit.doctor)}</span>` : ''}
              </div>
              ${fieldsHtml(t, visit)}
            </div>
          `,
        )
        .join('')
    : `
        ${visits[0].visitType ? `<span class="print-badge">${escapeHtml(visits[0].visitType)}</span>` : ''}
        ${fieldsHtml(t, visits[0])}
      `

  const heroDate = !isHistory ? `<div class="print-hero-date">${escapeHtml(formatDate(visits[0].date))}</div>` : ''

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(petName)} — ${escapeHtml(title)}</title>
    <style>${PRINT_STYLES}</style>
  </head>
  <body>
    <header class="print-header">
      <div>
        <h1>${escapeHtml(clinicLabel)}</h1>
        ${clinicPhone ? `<p class="print-clinic-phone">${escapeHtml(clinicPhone)}</p>` : ''}
        <p>${escapeHtml(title)}</p>
      </div>
      <div class="print-printed-at">${escapeHtml(t('printSummary.printedOn'))} ${escapeHtml(formatDateTime(new Date()))}</div>
    </header>
    <div class="print-hero">
      <div>
        <div class="print-hero-name">${escapeHtml(petName)}</div>
        ${petNumber ? `<div class="print-hero-id">${escapeHtml(t('pets.petId'))} <span dir="ltr">${petNumber}</span></div>` : ''}
        ${!isHistory && visits[0].owner ? `<div class="print-hero-id">${escapeHtml(t('pets.owner'))}: ${escapeHtml(visits[0].owner)}</div>` : ''}
        ${!isHistory && visits[0].doctor ? `<div class="print-hero-id">${escapeHtml(t('printSummary.doctor'))}: ${escapeHtml(visits[0].doctor)}</div>` : ''}
      </div>
      ${heroDate}
    </div>
    ${body}
    <footer class="print-footer">${escapeHtml(clinicPhone ? `${clinicLabel} · ${clinicPhone}` : clinicLabel)}</footer>
  </body>
</html>`
}

// Saudi tax invoices carry both languages: every label prints in English and Arabic.
const bi = (key: TranslationKey) => `${translations.en[key]} · ${translations.ar[key]}`
const money = (amount: number) => `<span dir="ltr">${formatMoney(amount)} SAR</span>`

const INVOICE_STYLES = `
  .inv-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.25rem 2rem; margin: 0 0 1.5rem; }
  .inv-meta div { display: flex; justify-content: space-between; gap: 1rem; border-bottom: 1px solid #eee; padding: 0.25rem 0; }
  .inv-meta span:first-child { color: #666; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 1rem; }
  th { text-align: start; font-size: 0.78rem; color: #666; border-bottom: 2px solid #b8860b; padding: 0.4rem 0.25rem; }
  td { padding: 0.4rem 0.25rem; border-bottom: 1px solid #eee; vertical-align: top; }
  .num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .inv-discount td { color: #8a6408; font-size: 0.85rem; }
  .inv-totals { margin-inline-start: auto; width: min(100%, 380px); }
  .inv-totals td { border-bottom: none; padding: 0.2rem 0.25rem; }
  .inv-grand td { font-size: 1.15rem; font-weight: 700; border-top: 2px solid #000; }
  .inv-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-top: 1.5rem; }
  .print-qr svg { width: 140px; height: 140px; }
  .print-header p { text-transform: none; letter-spacing: normal; }
  .print-brand { display: flex; gap: 1rem; align-items: center; }
  .print-logo { width: 56px; height: 56px; object-fit: contain; border-radius: 10px; }
`

function buildInvoiceDocument(doc: InvoiceDoc, clinicLabel: string, clinicPhone: string | null, logo: string | null, rtl: boolean) {
  const title = bi(doc.kind === 'invoice' ? 'print.taxInvoice' : doc.kind === 'credit_note' ? 'payments.creditNote' : 'owners.depositReceipt')
  const deposit = doc.kind === 'deposit'
  // ZATCA phase 1: seller, VAT number, time, total and VAT as Base64 TLV in a QR code.
  let qr = ''
  if (doc.vatNumber) {
    const tlv = zatcaTlvBase64({
      seller: clinicLabel,
      vatNumber: doc.vatNumber,
      timestamp: new Date(doc.date).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      total: doc.total.toFixed(2),
      vat: doc.vat.toFixed(2),
    })
    const code = qrcode(0, 'M')
    code.addData(tlv)
    code.make()
    qr = `<div class="print-qr" data-tlv="${tlv}">${code.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>`
  }
  const ltr = (value: string | number) => `<span dir="ltr">${escapeHtml(String(value))}</span>`
  const meta = [
    [bi(doc.kind === 'invoice' ? 'payments.invoiceNumber' : doc.kind === 'credit_note' ? 'payments.creditNote' : 'owners.depositReceipt'), ltr(doc.number)],
    doc.invoiceNumber ? [bi('print.forInvoice'), ltr(doc.invoiceNumber)] : null,
    [bi('payments.date'), ltr(formatDateTime(doc.date))],
    [bi('print.branch'), escapeHtml(doc.branch)],
    doc.vatNumber ? [bi('settings.vatNumber'), ltr(doc.vatNumber)] : null,
    doc.owner ? [bi('pets.owner'), escapeHtml(doc.owner)] : null,
    doc.pet ? [bi('payments.pet'), `${escapeHtml(doc.pet.name)} · ${bi('pets.petId')} ${ltr(doc.pet.number)}`] : null,
  ]
    .filter((row) => row !== null)
    .map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`)
    .join('')
  const lines = doc.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.description)}</td><td class="num">${l.quantity}</td><td class="num">${money(l.unitPrice)}</td><td class="num">${money(l.total + (l.discount?.amount ?? 0))}</td></tr>` +
        (l.discount ? `<tr class="inv-discount"><td colspan="3">${escapeHtml(l.discount.label)}</td><td class="num">${money(-l.discount.amount)}</td></tr>` : ''),
    )
    .join('')
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${value}</td></tr>`
  const totals = [
    doc.billDiscount ? row(bi('payments.subtotal'), money(doc.total + doc.billDiscount.amount)) : '',
    doc.billDiscount ? row(escapeHtml(doc.billDiscount.label), `${money(-doc.billDiscount.amount)}`, 'inv-discount') : '',
    deposit ? '' : row(bi('payments.netTotal'), money(doc.total - doc.vat)),
    deposit ? '' : row(`${bi('payments.vat')}${doc.vatRate !== null ? ` ${ltr(`${doc.vatRate}%`)}` : ''}`, money(doc.vat)),
    row(bi('payments.total'), money(doc.total), 'inv-grand'),
    doc.credited ? row(bi('payments.creditedAmount'), `${money(-doc.credited)}`) : '',
    doc.paid !== undefined ? row(bi('payments.paid'), money(doc.paid)) : '',
    doc.remaining !== undefined ? row(bi('payments.remaining'), money(doc.remaining)) : '',
    doc.balanceAfter !== undefined ? row(bi('owners.balanceAfter'), money(doc.balanceAfter)) : '',
    doc.refund ? row(`${bi('payments.refund')} (${bi(doc.refund.method)})`, money(doc.refund.amount)) : '',
  ].join('')
  const payments = doc.payments?.length
    ? `<table><tr><th>${bi('payments.payments')}</th><th></th><th class="num">${bi('payments.amount')}</th></tr>${doc.payments
        .map((p) => `<tr><td>${bi(p.method)}</td><td>${ltr(formatDateTime(p.paidAt))}</td><td class="num">${money(p.amount)}</td></tr>`)
        .join('')}</table>`
    : ''
  return `<!doctype html>
<html dir="${rtl ? 'rtl' : 'ltr'}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(doc.number)}</title>
    <style>${PRINT_STYLES}${INVOICE_STYLES}</style>
  </head>
  <body>
    <header class="print-header">
      <div class="print-brand">
        ${logo ? `<img class="print-logo" src="${escapeHtml(logo)}" alt="" />` : ''}
        <div>
          <h1>${escapeHtml(clinicLabel)}</h1>
          ${clinicPhone ? `<p class="print-clinic-phone">${escapeHtml(clinicPhone)}</p>` : ''}
          <p>${title}</p>
        </div>
      </div>
    </header>
    <div class="inv-meta">${meta}</div>
    ${doc.reason ? `<p><strong>${bi('payments.discountReason')}:</strong> ${escapeHtml(doc.reason)}</p>` : ''}
    ${
      doc.lines.length
        ? `<table><tr><th>${bi('payments.itemDescription')}</th><th class="num">${bi('payments.quantity')}</th><th class="num">${bi('payments.unitPrice')}</th><th class="num">${bi('payments.total')}</th></tr>${lines}</table>`
        : ''
    }
    <table class="inv-totals">${totals}</table>
    ${payments}
    <div class="inv-foot">
      <p class="print-printed-at">${deposit ? '' : bi('payments.pricesIncludeVat')}</p>
      ${qr}
    </div>
    <footer class="print-footer">${escapeHtml(clinicPhone ? `${clinicLabel} · ${clinicPhone}` : clinicLabel)}</footer>
  </body>
</html>`
}

// A signed waiver (0084) prints in the language it was signed in, labels included.
function buildWaiverDocument(doc: WaiverDoc, clinicLabel: string, clinicPhone: string | null, logo: string | null) {
  const l = (key: TranslationKey) => escapeHtml(translations[doc.language][key])
  const ltr = (value: string) => `<span dir="ltr">${escapeHtml(value)}</span>`
  const meta = [
    [l('waivers.pet'), `${escapeHtml(doc.petName)}${doc.petNumber ? ` · ${l('pets.petId')} ${ltr(String(doc.petNumber))}` : ''}`],
    [l('waivers.signerName'), escapeHtml(doc.signerName)],
    [l('waivers.signedAt'), ltr(formatDateTime(doc.signedAt))],
    [l('waivers.collectedBy'), escapeHtml(doc.collectedBy)],
    [l('print.branch'), escapeHtml(doc.branch)],
  ]
    .map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`)
    .join('')
  return `<!doctype html>
<html dir="${doc.language === 'ar' ? 'rtl' : 'ltr'}" lang="${doc.language}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(doc.title)} — ${escapeHtml(doc.petName)}</title>
    <style>${PRINT_STYLES}${INVOICE_STYLES}
      .waiver-void { border: 2px solid #b00020; color: #b00020; padding: 0.75rem 1rem; border-radius: 6px; margin: 0 0 1.5rem; font-weight: 700; }
      .waiver-body { white-space: pre-wrap; font-size: 1.02rem; line-height: 1.7; margin: 0 0 2rem; }
      .waiver-signature img { max-width: 360px; max-height: 140px; border-bottom: 1px solid #000; display: block; }
    </style>
  </head>
  <body>
    <header class="print-header">
      <div class="print-brand">
        ${logo ? `<img class="print-logo" src="${escapeHtml(logo)}" alt="" />` : ''}
        <div>
          <h1>${escapeHtml(clinicLabel)}</h1>
          ${clinicPhone ? `<p class="print-clinic-phone">${escapeHtml(clinicPhone)}</p>` : ''}
          <p>${escapeHtml(doc.title)}</p>
        </div>
      </div>
    </header>
    ${doc.voided ? `<div class="waiver-void">${l('waivers.voided')} · ${ltr(formatDateTime(doc.voided.at))} · ${escapeHtml(doc.voided.by)}<br />${escapeHtml(doc.voided.reason)}</div>` : ''}
    <div class="inv-meta">${meta}</div>
    <div class="waiver-body">${escapeHtml(doc.body)}</div>
    <div class="waiver-signature">
      <img src="${escapeHtml(doc.signature)}" alt="" />
      <p>${escapeHtml(doc.signerName)}</p>
    </div>
    <footer class="print-footer">${escapeHtml(clinicPhone ? `${clinicLabel} · ${clinicPhone}` : clinicLabel)}</footer>
  </body>
</html>`
}

function buildReportDocument(doc: ReportDoc, clinicLabel: string, printedOn: string, rtl: boolean) {
  const cells = (row: string[], num: boolean[], tag: 'td' | 'th') =>
    row.map((c, i) => (num[i] ? `<${tag} class="num"><span dir="ltr">${escapeHtml(c)}</span></${tag}>` : `<${tag}>${escapeHtml(c)}</${tag}>`)).join('')
  const sections = doc.sections
    .map(
      (s) => `${s.title ? `<h2>${escapeHtml(s.title)}</h2>` : ''}<table>
        <tr>${cells(s.head, s.num, 'th')}</tr>
        ${s.rows.map((r) => `<tr>${cells(r, s.num, 'td')}</tr>`).join('')}
        ${s.foot ? `<tr class="report-foot">${cells(s.foot, s.num, 'td')}</tr>` : ''}
      </table>`,
    )
    .join('')
  return `<!doctype html>
<html dir="${rtl ? 'rtl' : 'ltr'}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(doc.title)}</title>
    <style>${PRINT_STYLES}${INVOICE_STYLES} h2 { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; } .report-foot td { font-weight: 700; border-top: 2px solid #000; }</style>
  </head>
  <body>
    <header class="print-header">
      <div>
        <h1>${escapeHtml(clinicLabel)}</h1>
        <p>${escapeHtml(doc.title)}</p>
      </div>
      <div class="print-printed-at">${escapeHtml(printedOn)} <span dir="ltr">${escapeHtml(formatDateTime(new Date()))}</span></div>
    </header>
    ${doc.meta.map((m) => `<p>${escapeHtml(m)}</p>`).join('')}
    ${sections}
    ${doc.note ? `<p class="print-printed-at">${escapeHtml(doc.note)}</p>` : ''}
  </body>
</html>`
}

export function PrintProvider({ children }: { children: ReactNode }) {
  const { t, language } = useLanguage()
  const { clinicName, clinicPhone, clinicLogoUrl: logo } = useAuth()
  const toast = useToast()

  const runPrint = useCallback(
    async (petName: string, visits: VisitSummary[], petNumber?: number) => {
      const clinicLabel = clinicName ?? t('auth.brand')

      // A separate print window, not an in-page portal — it's a fully
      // self-contained document with its own styles, so there's no React
      // render-timing race to get wrong and no dependency on hiding the
      // rest of the app via print media queries.
      // Opened before any await: popup blockers only allow it inside the click.
      const printWindow = window.open('', '_blank', 'width=800,height=1000')
      if (!printWindow) {
        toast.error(t('printSummary.popupBlocked'))
        return
      }

      const signedVisits = await Promise.all(
        visits.map(async (visit) => (visit.photoUrl ? { ...visit, photoUrl: await signPhotoUrl(visit.photoUrl) } : visit)),
      )
      const html = buildDocument(t, clinicLabel, clinicPhone, petName, signedVisits, petNumber)
      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()
      printWindow.onload = () => {
        printWindow.focus()
        printWindow.print()
      }
    },
    [clinicName, clinicPhone, t, toast],
  )

  const printSummary = useCallback((petName: string, visit: VisitSummary, petNumber?: number) => runPrint(petName, [visit], petNumber), [runPrint])
  const printHistory = useCallback((petName: string, visits: VisitSummary[], petNumber?: number) => runPrint(petName, visits, petNumber), [runPrint])

  const printInvoice = useCallback(
    (doc: InvoiceDoc) => {
      const printWindow = window.open('', '_blank', 'width=800,height=1000')
      if (!printWindow) {
        toast.error(t('printSummary.popupBlocked'))
        return
      }
      printWindow.document.open()
      printWindow.document.write(buildInvoiceDocument(doc, clinicName ?? t('auth.brand'), clinicPhone, logo ? clinicLogoUrl(logo) : null, language === 'ar'))
      printWindow.document.close()
      printWindow.onload = () => {
        printWindow.focus()
        printWindow.print()
      }
    },
    [clinicName, clinicPhone, logo, language, t, toast],
  )

  const printReport = useCallback(
    (doc: ReportDoc) => {
      const printWindow = window.open('', '_blank', 'width=1000,height=1000')
      if (!printWindow) {
        toast.error(t('printSummary.popupBlocked'))
        return
      }
      printWindow.document.open()
      printWindow.document.write(buildReportDocument(doc, clinicName ?? t('auth.brand'), t('printSummary.printedOn'), language === 'ar'))
      printWindow.document.close()
      printWindow.onload = () => {
        printWindow.focus()
        printWindow.print()
      }
    },
    [clinicName, language, t, toast],
  )

  const printWaiver = useCallback(
    (doc: WaiverDoc) => {
      const printWindow = window.open('', '_blank', 'width=800,height=1000')
      if (!printWindow) {
        toast.error(t('printSummary.popupBlocked'))
        return
      }
      printWindow.document.open()
      printWindow.document.write(buildWaiverDocument(doc, clinicName ?? t('auth.brand'), clinicPhone, logo ? clinicLogoUrl(logo) : null))
      printWindow.document.close()
      printWindow.onload = () => {
        printWindow.focus()
        printWindow.print()
      }
    },
    [clinicName, clinicPhone, logo, t, toast],
  )

  return <PrintContext.Provider value={{ printWaiver, printInvoice, printSummary, printHistory, printReport }}>{children}</PrintContext.Provider>
}

export function usePrintSummary() {
  const ctx = useContext(PrintContext)
  if (!ctx) throw new Error('usePrintSummary must be used within a PrintProvider')
  return ctx
}
