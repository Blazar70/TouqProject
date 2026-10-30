import { roundHalalas } from './vat'

/** Balance right after each entry, newest first. The balance is always the sum of its entries (0064). */
export function balancesAfter(current: number, amountsNewestFirst: number[]) {
  let balance = current
  return amountsNewestFirst.map((amount) => {
    const after = balance
    balance = roundHalalas(balance - amount)
    return after
  })
}

// The balance lives in owner_balances (0088), readable by reception and managers only; selects embed it as
// `balance:owner_balances(balance)`. Flattened back to a number (0 when there is none or it is hidden).
export const BALANCE_EMBED = 'balance:owner_balances(balance)'
export function flatBalance<T extends { balance: { balance: number } | null }>(owner: T): Omit<T, 'balance'> & { balance: number } {
  return { ...owner, balance: owner.balance?.balance ?? 0 }
}
