import { describe, expect, it } from 'vitest'
import { decodeZatcaTlv, zatcaTlvBase64 } from './zatcaQr'

describe('zatcaTlvBase64', () => {
  it('matches the widely published ZATCA sample', () => {
    const b64 = zatcaTlvBase64({ seller: 'Bobs Records', vatNumber: '310122393500003', timestamp: '2022-04-25T15:30:00Z', total: '1000.00', vat: '150.00' })
    expect(b64).toBe('AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==')
  })

  it('uses UTF-8 byte lengths for an Arabic seller name', () => {
    const seller = 'عيادة طوق'
    const b64 = zatcaTlvBase64({ seller, vatNumber: '300000000000003', timestamp: '2026-10-22T09:00:00Z', total: '135.00', vat: '17.61' })
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    expect(bytes[0]).toBe(1)
    expect(bytes[1]).toBe(17) // 8 Arabic letters x 2 bytes + a space, not 9 characters
    expect(decodeZatcaTlv(b64)).toEqual([seller, '300000000000003', '2026-10-22T09:00:00Z', '135.00', '17.61'])
  })

  it('refuses a value over 255 bytes', () => {
    expect(() => zatcaTlvBase64({ seller: 'x'.repeat(256), vatNumber: '', timestamp: '', total: '', vat: '' })).toThrow()
  })
})
