import { describe, expect, it } from 'vitest'
import { registerPrefill, searchNorm, searchPatterns } from './search'

describe('searchNorm', () => {
  it('matches the SQL search_norm() of 0101', () => {
    // Same string and result as the assert in the 0101 rehearsal on staging.
    expect(searchNorm('أَحْمَد إبراهيم آمنة مـصطفى ٠٥٠١ ۱۲ Ahmed')).toBe('احمد ابراهيم امنه مصطفي 0501 12 ahmed')
  })
})

describe('searchPatterns', () => {
  it('is empty for an empty box', () => {
    expect(searchPatterns('  ')).toEqual([])
  })
  it('matches a phone on its digits, without the local leading zero', () => {
    expect(searchPatterns('050 123-4')).toEqual(['%501234%'])
    expect(searchPatterns('٠٥٠١')).toEqual(['%501%'])
    expect(searchPatterns('+966 50')).toEqual(['%96650%'])
  })
  it('keeps names as typed (folded) and escapes ilike wildcards', () => {
    expect(searchPatterns(' أحمد ')).toEqual(['%احمد%'])
    expect(searchPatterns('50%_off')).toEqual(['%50\\%\\_off%'])
  })
  it('splits words so they match in any order (H45)', () => {
    expect(searchPatterns('Luna  Ahmed')).toEqual(['%luna%', '%ahmed%'])
    expect(searchPatterns('ahmed 0501')).toEqual(['%ahmed%', '%501%'])
  })
})

describe('registerPrefill', () => {
  it('puts the search text into the field it looks like', () => {
    expect(registerPrefill('050 123 4567')).toBe('?phone=501234567')
    expect(registerPrefill('٠٥٠١٢٣٤٥٦٧')).toBe('?phone=501234567')
    expect(registerPrefill('900 123456789012')).toBe('?microchip=900123456789012')
    expect(registerPrefill(' Luna ')).toBe('?name=Luna')
    expect(registerPrefill('لونا')).toBe(`?name=${encodeURIComponent('لونا')}`)
  })
})
