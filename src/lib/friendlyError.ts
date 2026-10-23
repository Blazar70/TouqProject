import type { TranslationKey } from './i18n/translations'

// shortcut: matches known English texts (network, auth, push, user-facing DB raises);
// anything else shows as-is. Upgrade to error codes from the SQL functions if this list grows.
const KNOWN: [string, TranslationKey][] = [
  ['Failed to fetch', 'errors.offline'],
  ['NetworkError', 'errors.offline'],
  ['Load failed', 'errors.offline'],
  ['Invalid login credentials', 'errors.invalidLogin'],
  ['Notification permission denied', 'errors.pushDenied'],
  ['This doctor is away', 'errors.doctorAway'],
  ['This visit is already billed', 'errors.visitBilled'],
  ['Not enough balance', 'errors.notEnoughBalance'],
  ['Discount over the staff limit', 'errors.discountOverLimit'],
  ['Enter an amount up to what is still owed', 'errors.amountOverOwed'],
  ['The payments are more than the invoice total', 'errors.paymentsOverTotal'],
  ['Enter a discount between 0', 'errors.discountRange'],
  ['needs a reason', 'errors.needsReason'],
  ['One of these lines is already credited', 'errors.alreadyCredited'],
  ['Only receptionists and managers can add balance', 'errors.balanceRole'],
  ['A payment time can', 'errors.paymentInFuture'],
  ['Only receptionists and managers can issue credit notes', 'errors.creditRole'],
]

export function friendlyErrorKey(message: string): TranslationKey | null {
  return KNOWN.find(([text]) => message.includes(text))?.[1] ?? null
}
