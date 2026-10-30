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

// `ilike` pattern for a typed query, or null when empty. Phones are stored as +9665…, so a number typed
// as "050 123", "+966 50…" or "٠٥٠١" is matched on its digits without the leading zero.
export function searchPattern(query: string): string | null {
  let term = searchNorm(query.trim())
  if (!term) return null
  const digits = term.replace(/[\s+-]/g, '')
  if (/^\d+$/.test(digits)) term = digits.replace(/^0+(?=\d)/, '')
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`
}
