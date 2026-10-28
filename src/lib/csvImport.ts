import { toLatinDigits } from './arabicDigits'
import { formatSaudiPhoneInput, isValidSaudiMobile } from './phone'
import { POPULAR_SPECIES } from './species'
import type { TranslationKey } from './i18n/translations'

// Admin import of a clinic's owners and pets (0097). The template's columns, in order:
export const IMPORT_COLUMNS = ['owner_name', 'owner_phone', 'owner_email', 'pet_name', 'species', 'breed', 'date_of_birth'] as const
type Column = (typeof IMPORT_COLUMNS)[number]
export type ImportRow = Record<Column, string>
export type ImportError = { line: number; key: TranslationKey }
export const IMPORT_MAX_ROWS = 5000

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. Excel set to Arabic/European
// regions saves with ";" instead, so the header line picks the separator.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0]
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) rows.push([...row, cell])
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

// 2022-03-01, 1/3/2022 or 01/03/2022 (day first, as written in KSA) -> YYYY-MM-DD; '' when empty, null when unreadable.
function isoDate(raw: string): string | null {
  const v = toLatinDigits(raw.trim())
  if (!v) return ''
  const iso8601 = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const dayFirst = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  const [y, mo, d] = iso8601 ? [iso8601[1], iso8601[2], iso8601[3]] : dayFirst ? [dayFirst[3], dayFirst[2], dayFirst[1]] : []
  if (!y || !mo || !d) return null
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  const date = new Date(`${iso}T00:00:00Z`)
  return !isNaN(date.getTime()) && date.toISOString().startsWith(iso) && date <= new Date() ? iso : null
}

// Header row -> cleaned rows ready for admin_import_owners_pets, plus every problem with its spreadsheet line number.
export function buildImport(table: string[][]): { rows: ImportRow[]; errors: ImportError[] } {
  const [header, ...body] = table
  const index = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, (header ?? []).findIndex((h) => h.trim().toLowerCase() === c)]))
  if (['owner_name', 'pet_name', 'species'].some((c) => index[c] < 0)) return { rows: [], errors: [{ line: 1, key: 'import.badHeader' }] }
  if (body.length === 0) return { rows: [], errors: [{ line: 1, key: 'import.empty' }] }
  if (body.length > IMPORT_MAX_ROWS) return { rows: [], errors: [{ line: 1, key: 'import.tooMany' }] }

  const rows: ImportRow[] = []
  const errors: ImportError[] = []
  body.forEach((cells, i) => {
    const line = i + 2
    const get = (c: Column) => (index[c] >= 0 ? (cells[index[c]] ?? '').trim() : '')
    const known = POPULAR_SPECIES.find((s) => s.value.toLowerCase() === get('species').toLowerCase())
    const digits = get('owner_phone') ? formatSaudiPhoneInput(get('owner_phone')) : ''
    const dob = isoDate(get('date_of_birth'))
    const row: ImportRow = {
      owner_name: get('owner_name'),
      owner_phone: digits ? `+966${digits}` : '',
      owner_email: get('owner_email'),
      pet_name: get('pet_name'),
      species: known?.value ?? get('species'),
      breed: get('breed'),
      date_of_birth: dob ?? '',
    }
    if (!row.owner_name || !row.pet_name || !row.species) errors.push({ line, key: 'import.missingRequired' })
    if (get('owner_phone') && !isValidSaudiMobile(digits)) errors.push({ line, key: 'import.badPhone' })
    if (dob === null) errors.push({ line, key: 'import.badDate' })
    rows.push(row)
  })
  return { rows, errors }
}
