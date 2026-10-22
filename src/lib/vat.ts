// Saudi VAT is 15%; new services default to it.
export const DEFAULT_VAT_RATE = 15

// Round to 2 decimals (halalas). EPSILON nudges values like 1.005 that are
// stored as 1.00499999… so they round up the way a person would expect.
export function roundHalalas(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function priceWithVat(preVat: number, vatRate: number): number {
  return roundHalalas(preVat * (1 + vatRate / 100))
}

// 4 decimals, not 2: stored pre-VAT prices need the extra precision so the
// post-VAT price staff typed comes back exactly (150 -> 130.4348 -> 150.00).
export function priceWithoutVat(postVat: number, vatRate: number): number {
  return Math.round((postVat / (1 + vatRate / 100) + Number.EPSILON) * 10000) / 10000
}

// The price fields on a service form, kept as the raw strings the user typed.
// Staff type what the customer pays (post-VAT) and the rate; pre-VAT is only
// derived, and cleared rather than left stale when it can't be computed.
export type VatFields = { pre: string; rate: string; post: string }

export function updateVatFields(fields: VatFields, field: 'rate' | 'post', value: string): VatFields {
  const next = { ...fields, [field]: value }
  const rate = parseFloat(next.rate)
  const post = parseFloat(next.post)
  const ok = !Number.isNaN(rate) && rate >= 0 && rate <= 100 && !Number.isNaN(post)
  next.pre = ok ? priceWithoutVat(post, rate).toFixed(2) : ''
  return next
}
