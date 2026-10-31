import { cleanMicrochip, isValidMicrochip } from './microchip'
import { formatSaudiPhoneInput, isValidSaudiMobile } from './phone'

// Server search over pets.search_text / owner_files.search_text (0101): the API returns at most 1,000 rows,
// so lists search the database instead of filtering a downloaded list (nightly B29).

// Mirror of search_norm() in 0101: Arabic letter forms folded, tashkeel/tatweel dropped, Arabic digits Latin.
export function searchNorm(text: string) {
  return text
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ـً-ْٰ]/g, '')
}

// One `ilike` pattern per typed word (all must match, any order: "luna ahmed" finds Ahmed's Luna, H45); none when
// empty. Phones are stored as +9665…, so a number typed as "050 123", "+966 50…" or "٠٥٠١" is one term on its
// digits without the leading zero.
export function searchPatterns(query: string): string[] {
  const term = searchNorm(query.trim())
  const digits = term.replace(/[\s+-]/g, '')
  const words = /^\d+$/.test(digits) ? [digits] : term.split(/\s+/).filter(Boolean)
  return words.map((word) => `%${word.replace(/^0+(?=\d+$)/, '').replace(/[\\%_]/g, '\\$&')}%`)
}

// "Register new pet" from a search with no match (H44): the typed text goes into the field it looks like.
export function registerPrefill(query: string): string {
  const text = query.trim()
  const phone = formatSaudiPhoneInput(text)
  const chip = cleanMicrochip(text)
  if (isValidSaudiMobile(phone) && /^[\d\s+٠-٩-]+$/.test(text)) return `?phone=${phone}`
  if (isValidMicrochip(chip)) return `?microchip=${encodeURIComponent(chip)}`
  return `?name=${encodeURIComponent(text)}`
}
