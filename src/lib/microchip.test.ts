import { describe, expect, it } from 'vitest'
import { cleanMicrochip, isValidMicrochip } from './microchip'

describe('microchip', () => {
  it('cleans scanner or Arabic input to the stored form', () => {
    expect(cleanMicrochip('982 000 ١٢٣٤٥٦٧٨٩')).toBe('982000123456789')
    expect(cleanMicrochip('abc1234567')).toBe('ABC1234567')
  })
  it('accepts 9 digits, 10 hex or 15 digits only (as 0101 does)', () => {
    expect(['123456789', 'ABC1234567', '982000123456789'].every(isValidMicrochip)).toBe(true)
    expect(['12345', '98200012345678', 'GHI1234567', '9820001234567890'].some(isValidMicrochip)).toBe(false)
  })
})
