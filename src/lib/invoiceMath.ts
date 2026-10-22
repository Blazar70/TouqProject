import { roundHalalas } from './vat'
import type { TranslationKey } from './i18n/translations'
import type { Database } from './database.types'

type Tables = Database['public']['Tables']
export type InvoiceFull = Tables['invoices']['Row'] & {
  pets: { name: string; pet_number: number; owner_file_id: string; owner_phone: string | null } | null
  invoice_items: Tables['invoice_items']['Row'][]
  invoice_payments: Tables['invoice_payments']['Row'][]
  credit_notes: Tables['credit_notes']['Row'][]
}
export const INVOICE_SELECT = '*, pets(name, pet_number, owner_file_id, owner_phone), invoice_items(*), invoice_payments(*), credit_notes(*)'

// Mirrors create_invoice() in supabase/migrations/0061_invoicing_core.sql so the
// form shows the totals the database will save. The database is the authority.

export type Discount = { type: 'percent' | 'amount'; value: number; reason: string }

export type InvoiceLineInput = { unitPrice: number; quantity: number; vatRate: number; discount: Discount | null }

/** Discount amount on a VAT-inclusive base. */
export function discountAmount(base: number, discount: Discount | null): number {
  if (!discount || !(discount.value > 0)) return 0 // a half-typed discount previews as none
  return discount.type === 'percent' ? roundHalalas((base * discount.value) / 100) : roundHalalas(discount.value)
}

/** A fixed amount counts as its percent of what it applies to (for the staff limit). */
export function discountPercent(base: number, discount: Discount): number {
  return discount.type === 'percent' ? discount.value : base > 0 ? (discount.value * 100) / base : 0
}

export function isDiscountValid(base: number, discount: Discount): boolean {
  if (!discount.reason.trim() || !(discount.value > 0)) return false
  return discount.type === 'percent' ? discount.value <= 100 : discount.value <= base
}

/** VAT inside a VAT-inclusive amount: r% of the net. */
export const vatIn = (amount: number, rate: number) => roundHalalas((amount * rate) / (100 + rate))

export function invoiceTotals(lines: InvoiceLineInput[], billDiscount: Discount | null) {
  const rows = lines.map((l) => {
    const gross = roundHalalas(l.unitPrice * l.quantity)
    const discount = discountAmount(gross, l.discount)
    return { gross, discount, after: roundHalalas(gross - discount), share: 0, vat: 0 }
  })
  const sum = roundHalalas(rows.reduce((s, r) => s + r.after, 0))
  const bill = discountAmount(sum, billDiscount)
  // Spread the bill discount by amount; the rounding remainder goes on the biggest line.
  let big = 0
  rows.forEach((r, i) => {
    r.share = sum === 0 ? 0 : roundHalalas((bill * r.after) / sum)
    if (r.after > rows[big].after) big = i
  })
  if (rows.length) rows[big].share = roundHalalas(rows[big].share + bill - rows.reduce((s, r) => s + r.share, 0))
  rows.forEach((r, i) => (r.vat = vatIn(r.after - r.share, lines[i].vatRate)))
  const total = roundHalalas(sum - bill)
  const vat = roundHalalas(rows.reduce((s, r) => s + r.vat, 0))
  return { rows, sum, bill, total, vat, net: roundHalalas(total - vat) }
}

export type PaymentStatus = 'unpaid' | 'partly_paid' | 'paid'

/** What is still owed, as the database computes it. */
export function amountRemaining(inv: { amount_total: number; amount_credited: number; amount_paid: number; amount_refunded: number }) {
  return Math.max(0, roundHalalas(inv.amount_total - inv.amount_credited - (inv.amount_paid - inv.amount_refunded)))
}

/** Branch invoice code from its name; same rule as default_invoice_code() in 0060. */
export function defaultInvoiceCode(name: string, taken: string[]): string {
  const latin = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  const base = latin.length < 2 ? 'BR' : latin
  let code = latin.length < 2 ? 'BR1' : latin
  for (let n = 2; taken.includes(code); n++) code = base.slice(0, 6 - String(n).length) + n
  return code
}

export const isValidInvoiceCode = (code: string) => /^[A-Z0-9]{2,6}$/.test(code)

/** Saudi VAT registration number: 15 digits, starts and ends with 3. */
export const isValidVatNumber = (value: string) => /^3\d{13}3$/.test(value)

// invoice_payments.method (0061); 'balance' (0064) is offered only when the owner has some.
export const PAYMENT_METHODS = ['cash', 'card', 'apple_pay'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number] | 'balance'
export const METHOD_LABEL_KEYS: Record<string, TranslationKey> = {
  cash: 'payments.methodCash',
  card: 'payments.methodCard',
  apple_pay: 'payments.methodApplePay',
  balance: 'payments.methodBalance',
}

/** The methods to offer: the owner's balance only when there is some. */
export const methodsFor = (balance: number | null): PaymentMethod[] => (balance ? [...PAYMENT_METHODS, 'balance'] : [...PAYMENT_METHODS])

/** What the payment parts take from the owner's balance. */
export const balanceUsed = (payments: { method: string; amount: number }[]) =>
  roundHalalas(payments.filter((p) => p.method === 'balance').reduce((sum, p) => sum + p.amount, 0))
