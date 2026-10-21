import { formatIsoDate } from './format'

export const BILLING_DUE_WINDOW_DAYS = 7

// A Touq subscription payment (admin Billing) needs chasing when it is unpaid
// and either marked overdue, past its due date, or due within the window.
// Due dates are yyyy-mm-dd, so they compare as text.
export function billingDueState(payment: { status: string; due_date: string | null }, now = new Date()) {
  if (payment.status !== 'pending' && payment.status !== 'overdue') return null
  const today = formatIsoDate(now)
  if (payment.status === 'overdue' || (payment.due_date && payment.due_date < today)) return 'overdue'
  const soon = new Date(now)
  soon.setDate(soon.getDate() + BILLING_DUE_WINDOW_DAYS)
  if (payment.due_date && payment.due_date <= formatIsoDate(soon)) return 'soon'
  return null
}
