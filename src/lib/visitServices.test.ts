import { describe, expect, it } from 'vitest'
import { toPaymentLines, visitTotal } from './visitServices'

const exam = { service_id: 's1', description: 'Exam', unit_price: 130.4348, vat_rate: 15, quantity: 2 }
const vaccine = { service_id: null, description: 'Old vaccine', unit_price: 100, vat_rate: 0, quantity: 1 }

describe('visit services', () => {
  it('totals with VAT per unit, times quantity', () => {
    expect(visitTotal([exam, vaccine])).toBe(400)
    expect(visitTotal([])).toBe(0)
  })

  it('builds one payment line per service with the post-VAT price', () => {
    expect(toPaymentLines([exam, vaccine])).toEqual([
      { serviceId: 's1', description: 'Exam', unitPrice: '150', quantity: '2' },
      { serviceId: '', description: 'Old vaccine', unitPrice: '100', quantity: '1' },
    ])
  })
})
