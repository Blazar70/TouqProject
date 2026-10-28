import { describe, expect, it } from 'vitest'
import { buildImport, parseCsv } from './csvImport'

describe('parseCsv', () => {
  it('reads quotes, commas inside quotes, CRLF, BOM and skips blank lines', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ])
  })
  it('uses ; when the header line does', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('buildImport', () => {
  const header = ['owner_name', 'owner_phone', 'pet_name', 'species', 'date_of_birth']

  it('cleans phones, species and dates', () => {
    const { rows, errors } = buildImport([header, ['سارة', '٠٥٠١٢٣٤٥٦٧', 'Milo', 'cat', '1/3/2022']])
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ owner_phone: '+966501234567', species: 'Cat', date_of_birth: '2022-03-01' })
  })

  it('lists bad rows with their spreadsheet line', () => {
    const { errors } = buildImport([header, ['A', '12345', 'P', 'Dog', ''], ['', '', 'Q', 'Dog', '31/02/2022']])
    expect(errors).toEqual([
      { line: 2, key: 'import.badPhone' },
      { line: 3, key: 'import.missingRequired' },
      { line: 3, key: 'import.badDate' },
    ])
  })

  it('refuses a file without the needed columns', () => {
    expect(buildImport([['name', 'pet']]).errors[0].key).toBe('import.badHeader')
  })
})
