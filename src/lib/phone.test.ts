import { describe, expect, it } from 'vitest'
import { formatSaudiPhoneInput, isValidSaudiMobile, stripSaudiPrefix } from './phone'

describe('formatSaudiPhoneInput', () => {
  it('strips non-digit characters', () => {
    expect(formatSaudiPhoneInput('5X-XXX-XXXX'.replace(/X/g, '1'))).toBe('511111111')
    expect(formatSaudiPhoneInput('50 123 4567')).toBe('501234567')
  })

  it('drops a leading 0 (local dialing prefix)', () => {
    expect(formatSaudiPhoneInput('0512345678')).toBe('512345678')
  })

  it('truncates to 9 digits', () => {
    expect(formatSaudiPhoneInput('5123456789999')).toBe('512345678')
  })

  it('returns empty string for non-numeric input', () => {
    expect(formatSaudiPhoneInput('abc')).toBe('')
  })
})

describe('isValidSaudiMobile', () => {
  it('accepts a 9-digit number starting with 5', () => {
    expect(isValidSaudiMobile('512345678')).toBe(true)
  })

  it('rejects numbers not starting with 5', () => {
    expect(isValidSaudiMobile('412345678')).toBe(false)
  })

  it('rejects numbers with the wrong length', () => {
    expect(isValidSaudiMobile('51234567')).toBe(false)
    expect(isValidSaudiMobile('5123456789')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidSaudiMobile('')).toBe(false)
  })
})

describe('stripSaudiPrefix', () => {
  it('removes the +966 prefix', () => {
    expect(stripSaudiPrefix('+966512345678')).toBe('512345678')
  })

  it('returns empty string for null', () => {
    expect(stripSaudiPrefix(null)).toBe('')
  })

  it('leaves a number without the prefix unchanged', () => {
    expect(stripSaudiPrefix('512345678')).toBe('512345678')
  })
})
