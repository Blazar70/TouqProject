import { describe, expect, it } from 'vitest'
import { appointmentMessage, pickupMessage, vaccineMessage, whatsAppLink } from './ownerReminders'

const clinic = { name: 'Touq Clinic', phone: '+966112345678' }

describe('whatsAppLink', () => {
  it('uses international digits and encodes the text', () => {
    expect(whatsAppLink('+966501234567', 'a b&c')).toBe('https://wa.me/966501234567?text=a%20b%26c')
  })
  it('turns a local 05 number into 966', () => {
    expect(whatsAppLink('0501234567', 'x')).toBe('https://wa.me/966501234567?text=x')
  })
  it('has no link without a usable phone', () => {
    expect(whatsAppLink(null, 'x')).toBeNull()
    expect(whatsAppLink('12', 'x')).toBeNull()
  })
})

describe('messages', () => {
  it('lists every due vaccine in Arabic first, then English, with the clinic phone', () => {
    const text = vaccineMessage(clinic, 'Faisal', [
      { pet: 'Max', vaccine: 'Rabies', due: '2026-11-02' },
      { pet: 'Luna', vaccine: 'Combo', due: '2026-10-30' },
    ])
    expect(text.indexOf('مرحبًا')).toBeLessThan(text.indexOf('Hello'))
    expect(text).toContain('- Max: Rabies (Monday, November 2)')
    expect(text).toContain('- Luna: Combo (Friday, October 30)')
    expect(text).toContain('Questions: +966112345678')
  })
  it('gives the appointment day and time in clinic time', () => {
    // 07:30 UTC = 10:30 Riyadh
    const text = appointmentMessage(clinic, 'Faisal', 'Max', '2026-10-26T07:30:00Z', 'Main')
    expect(text).toContain('tomorrow, Monday, October 26 at 10:30 AM')
    expect(text).toContain('(Main)')
  })
  it('leaves the phone line out when the clinic has none', () => {
    expect(pickupMessage({ name: 'Touq', phone: null }, 'Faisal', 'Max', 'East')).not.toContain('Questions')
  })
})
