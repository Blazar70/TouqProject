import { describe, expect, it } from 'vitest'
import { scrubPhones } from './scrubPhones'

describe('scrubPhones', () => {
  it('blanks phone-like digit runs and keeps short numbers', () => {
    expect(scrubPhones('Key (phone)=(+966501234567) exists, row 12')).toBe('Key (phone)=([phone]) exists, row 12')
    expect(scrubPhones('0501234567')).toBe('[phone]')
  })
})
