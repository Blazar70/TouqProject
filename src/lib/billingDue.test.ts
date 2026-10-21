import { describe, expect, it } from 'vitest'
import { billingDueState } from './billingDue'

const now = new Date(2026, 9, 21, 12)

describe('billingDueState', () => {
  it('ignores paid and cancelled payments', () => {
    expect(billingDueState({ status: 'paid', due_date: '2026-10-01' }, now)).toBeNull()
    expect(billingDueState({ status: 'cancelled', due_date: '2026-10-01' }, now)).toBeNull()
  })

  it('flags overdue by status or past due date', () => {
    expect(billingDueState({ status: 'overdue', due_date: null }, now)).toBe('overdue')
    expect(billingDueState({ status: 'pending', due_date: '2026-10-20' }, now)).toBe('overdue')
  })

  it('flags pending payments due within 7 days, including today', () => {
    expect(billingDueState({ status: 'pending', due_date: '2026-10-21' }, now)).toBe('soon')
    expect(billingDueState({ status: 'pending', due_date: '2026-10-28' }, now)).toBe('soon')
    expect(billingDueState({ status: 'pending', due_date: '2026-10-29' }, now)).toBeNull()
    expect(billingDueState({ status: 'pending', due_date: null }, now)).toBeNull()
  })
})
