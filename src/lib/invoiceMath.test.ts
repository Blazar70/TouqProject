import { describe, expect, it } from 'vitest'
import { amountRemaining, defaultInvoiceCode, discountPercent, invoiceTotals, isDiscountValid, isValidVatNumber } from './invoiceMath'

const reason = 'r'

describe('invoiceTotals (same numbers as supabase/tests/0061_invoicing_core_check.sql)', () => {
  it('takes VAT out of the discounted amount', () => {
    const t = invoiceTotals([{ unitPrice: 150, quantity: 1, vatRate: 15, discount: { type: 'percent', value: 10, reason } }], null)
    expect(t.rows[0].discount).toBe(15)
    expect(t.total).toBe(135)
    expect(t.vat).toBe(17.61)
    expect(t.net).toBe(117.39)
  })

  it('spreads a bill discount over lines, each at its own VAT rate', () => {
    const t = invoiceTotals(
      [
        { unitPrice: 100, quantity: 1, vatRate: 15, discount: null },
        { unitPrice: 16.67, quantity: 3, vatRate: 0, discount: null },
      ],
      { type: 'amount', value: 10, reason },
    )
    expect(t.sum).toBe(150.01)
    expect(t.rows.map((r) => r.share)).toEqual([6.67, 3.33])
    expect(t.total).toBe(140.01)
    expect(t.vat).toBe(12.17)
  })

  it('puts the rounding remainder of the bill discount on the biggest line', () => {
    const t = invoiceTotals(
      [1, 1, 1].map(() => ({ unitPrice: 10, quantity: 1, vatRate: 15, discount: null })),
      { type: 'amount', value: 1, reason },
    )
    expect(t.rows.map((r) => r.share)).toEqual([0.34, 0.33, 0.33])
    expect(t.total).toBe(29)
  })

  it('handles no lines', () => {
    expect(invoiceTotals([], null).total).toBe(0)
  })
})

describe('discount limit math', () => {
  it('counts a fixed amount as its percent of the base', () => {
    expect(discountPercent(100, { type: 'amount', value: 11, reason })).toBe(11)
    expect(discountPercent(200, { type: 'percent', value: 10, reason })).toBe(10)
  })

  it('needs a reason and a value within the base', () => {
    expect(isDiscountValid(100, { type: 'percent', value: 10, reason: ' ' })).toBe(false)
    expect(isDiscountValid(100, { type: 'amount', value: 100.01, reason })).toBe(false)
    expect(isDiscountValid(100, { type: 'percent', value: 101, reason })).toBe(false)
    expect(isDiscountValid(100, { type: 'amount', value: 100, reason })).toBe(true)
  })
})

describe('amountRemaining', () => {
  it('subtracts credits and net payments, never below zero', () => {
    expect(amountRemaining({ amount_total: 200, amount_credited: 100, amount_paid: 50, amount_refunded: 0 })).toBe(50)
    expect(amountRemaining({ amount_total: 140.01, amount_credited: 140.01, amount_paid: 140.01, amount_refunded: 140.01 })).toBe(0)
  })
})

describe('defaultInvoiceCode (same rule as default_invoice_code() in 0060)', () => {
  it('takes up to 6 Latin letters/digits of the name', () => {
    expect(defaultInvoiceCode('East Riyadh', [])).toBe('EASTRI')
    expect(defaultInvoiceCode('North', [])).toBe('NORTH')
  })
  it('falls back to BR1 for a name without Latin letters', () => {
    expect(defaultInvoiceCode('الشمال', [])).toBe('BR1')
    expect(defaultInvoiceCode('الشمال', ['BR1'])).toBe('BR2')
  })
  it('adds a digit when the code is taken', () => {
    expect(defaultInvoiceCode('Main 2', ['MAIN'])).toBe('MAIN2')
    expect(defaultInvoiceCode('Main', ['MAIN'])).toBe('MAIN2')
    expect(defaultInvoiceCode('Riyadh', ['RIYADH'])).toBe('RIYAD2')
  })
})

describe('isValidVatNumber', () => {
  it('wants 15 digits starting and ending with 3', () => {
    expect(isValidVatNumber('310122393500003')).toBe(true)
    expect(isValidVatNumber('210122393500003')).toBe(false)
    expect(isValidVatNumber('31012239350000')).toBe(false)
    expect(isValidVatNumber('310122393500004')).toBe(false)
  })
})
