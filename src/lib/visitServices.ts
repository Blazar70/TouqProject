import { priceWithVat } from './vat'

// A service on a visit, priced as copied from the price list (pre-VAT + rate).
type VisitService = { service_id: string | null; description: string; unit_price: number; vat_rate: number; quantity: number }

export const visitUnitPrice = (s: VisitService) => priceWithVat(s.unit_price, s.vat_rate)

export const visitTotal = (rows: VisitService[]) => rows.reduce((sum, s) => sum + visitUnitPrice(s) * s.quantity, 0)

// "Bill this visit": one Payments form line per service, as the strings the form keeps.
export function toPaymentLines(rows: VisitService[]) {
  return rows.map((s) => ({
    serviceId: s.service_id ?? '',
    description: s.description,
    unitPrice: String(visitUnitPrice(s)),
    quantity: String(s.quantity),
  }))
}
