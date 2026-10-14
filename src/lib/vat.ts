// Saudi VAT is 15%; new services default to it.
export const DEFAULT_VAT_RATE = 15

// Round to 2 decimals (halalas). EPSILON nudges values like 1.005 that are
// stored as 1.00499999… so they round up the way a person would expect.
function roundHalalas(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function priceWithVat(preVat: number, vatRate: number): number {
  return roundHalalas(preVat * (1 + vatRate / 100))
}

export function priceWithoutVat(postVat: number, vatRate: number): number {
  return roundHalalas(postVat / (1 + vatRate / 100))
}

// The three price inputs on a service form, kept as the raw strings the
// user typed. Editing pre-VAT or the rate recalculates post-VAT; editing
// post-VAT recalculates pre-VAT. A field that can't be computed yet
// (empty/invalid input) is cleared rather than left stale.
export type VatFields = { pre: string; rate: string; post: string }

export function updateVatFields(fields: VatFields, field: keyof VatFields, value: string): VatFields {
  const next = { ...fields, [field]: value }
  const rate = parseFloat(next.rate)
  const rateOk = !Number.isNaN(rate) && rate >= 0 && rate <= 100
  if (field === 'post') {
    const post = parseFloat(next.post)
    next.pre = rateOk && !Number.isNaN(post) ? priceWithoutVat(post, rate).toFixed(2) : ''
  } else {
    const pre = parseFloat(next.pre)
    next.post = rateOk && !Number.isNaN(pre) ? priceWithVat(pre, rate).toFixed(2) : ''
  }
  return next
}
