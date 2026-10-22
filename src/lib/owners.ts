import { phoneKey } from './phone'
import { roundHalalas } from './vat'

/** Owner search: name, or any part of the phone typed in any form (05…, 5…, +966…). */
export function matchesOwner(owner: { name: string; phone: string | null }, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const digits = phoneKey(q)
  return owner.name.toLowerCase().includes(q) || (digits !== '' && phoneKey(owner.phone).includes(digits))
}

/** Balance right after each entry, newest first. The balance is always the sum of its entries (0064). */
export function balancesAfter(current: number, amountsNewestFirst: number[]) {
  let balance = current
  return amountsNewestFirst.map((amount) => {
    const after = balance
    balance = roundHalalas(balance - amount)
    return after
  })
}
