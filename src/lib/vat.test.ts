import { describe, expect, it } from 'vitest'
import { priceWithVat, priceWithoutVat, updateVatFields } from './vat'

describe('priceWithVat / priceWithoutVat', () => {
  it('adds and removes 15% VAT', () => {
    expect(priceWithVat(100, 15)).toBe(115)
    expect(priceWithoutVat(115, 15)).toBe(100)
  })

  it('round-trips pre -> post -> pre at 2 decimals', () => {
    for (const pre of [0, 0.01, 1, 19.99, 86.96, 250, 1234.56]) {
      expect(priceWithoutVat(priceWithVat(pre, 15), 15).toFixed(2)).toBe(pre.toFixed(2))
    }
  })

  it('a typed post-VAT price comes back exactly (every halala up to 2000)', () => {
    for (let halalas = 0; halalas <= 200000; halalas++) {
      const post = halalas / 100
      expect(priceWithVat(priceWithoutVat(post, 15), 15)).toBe(post)
    }
  })

  it('leaves the price unchanged at 0%', () => {
    expect(priceWithVat(42.5, 0)).toBe(42.5)
    expect(priceWithoutVat(42.5, 0)).toBe(42.5)
  })

  it('rounds post-VAT to halalas and pre-VAT to 4 decimals', () => {
    expect(priceWithoutVat(100, 15)).toBe(86.9565) // 86.95652…
    expect(priceWithoutVat(150, 15)).toBe(130.4348)
    expect(priceWithVat(86.96, 15)).toBe(100) // 100.004
    expect(priceWithVat(10.05, 10)).toBe(11.06) // 11.055, rounds half up
  })
})

describe('updateVatFields', () => {
  const empty = { pre: '', rate: '15', post: '' }

  it('editing pre-VAT fills post-VAT', () => {
    expect(updateVatFields(empty, 'pre', '100')).toEqual({ pre: '100', rate: '15', post: '115.00' })
  })

  it('editing post-VAT fills pre-VAT', () => {
    expect(updateVatFields(empty, 'post', '115')).toEqual({ pre: '100.00', rate: '15', post: '115' })
  })

  it('editing the rate recalculates post-VAT from pre-VAT', () => {
    const fields = { pre: '100', rate: '15', post: '115.00' }
    expect(updateVatFields(fields, 'rate', '5')).toEqual({ pre: '100', rate: '5', post: '105.00' })
  })

  it('clears the computed field when input is empty or invalid', () => {
    expect(updateVatFields({ pre: '100', rate: '15', post: '115.00' }, 'pre', '').post).toBe('')
    expect(updateVatFields({ pre: '100', rate: '15', post: '115.00' }, 'rate', '150').post).toBe('')
  })
})
