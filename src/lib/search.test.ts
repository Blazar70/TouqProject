import { describe, expect, it } from 'vitest'
import { searchNorm, searchPattern } from './search'

describe('searchNorm', () => {
  it('matches the SQL search_norm() of 0101', () => {
    // Same string and result as the assert in the 0101 rehearsal on staging.
    expect(searchNorm('أَحْمَد إبراهيم آمنة مـصطفى ٠٥٠١ ۱۲ Ahmed')).toBe('احمد ابراهيم امنه مصطفي 0501 12 ahmed')
  })
})

describe('searchPattern', () => {
  it('is null for an empty box', () => {
    expect(searchPattern('  ')).toBeNull()
  })
  it('matches a phone on its digits, without the local leading zero', () => {
    expect(searchPattern('050 123-4')).toBe('%501234%')
    expect(searchPattern('٠٥٠١')).toBe('%501%')
    expect(searchPattern('+966 50')).toBe('%96650%')
  })
  it('keeps names as typed (folded) and escapes ilike wildcards', () => {
    expect(searchPattern(' أحمد ')).toBe('%احمد%')
    expect(searchPattern('50%_off')).toBe('%50\\%\\_off%')
  })
})
