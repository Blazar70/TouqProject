import { toLatinDigits } from './arabicDigits'

// Microchip number (0101, nightly H42): ISO 11784/11785 = 15 digits; older AVID/FECAVA chips = 9 digits or 10 hex.
// Same rule as the pets_microchip_format check; a scanner types the number like a keyboard.
export const MICROCHIP_PATTERN = '[0-9]{9}|[0-9A-Fa-f]{10}|[0-9]{15}'

/** Arabic digits made Latin, spaces dropped, upper case: the form the database stores. */
export function cleanMicrochip(raw: string) {
  return toLatinDigits(raw).replace(/\s/g, '').toUpperCase()
}

export function isValidMicrochip(value: string) {
  return new RegExp(`^(${MICROCHIP_PATTERN})$`).test(value)
}
