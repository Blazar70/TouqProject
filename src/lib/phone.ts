// Saudi mobile numbers are 9 digits after the +966 country code, always
// starting with 5 (the leading 0 used in local dialing is dropped).
export const SAUDI_MOBILE_MAX_DIGITS = 9

export function formatSaudiPhoneInput(raw: string) {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = digits.slice(1)
  return digits.slice(0, SAUDI_MOBILE_MAX_DIGITS)
}

export function isValidSaudiMobile(digits: string) {
  return /^5\d{8}$/.test(digits)
}

// Strips the +966 prefix back off a stored number so it can be re-edited
// in a plain 9-digit input.
export function stripSaudiPrefix(stored: string | null) {
  if (!stored) return ''
  return stored.replace(/^\+966/, '')
}

// A clinic's own contact number is typically a landline, not a mobile
// number, so it doesn't fit the mobile-only shape above. This just rejects
// obviously malformed input (letters, way too few/many digits) instead of
// enforcing one specific format.
export function isValidClinicPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  return /^[\d+()\-\s]+$/.test(value) && digits.length >= 7 && digits.length <= 15
}
