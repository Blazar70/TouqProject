import { describe, expect, it, vi } from 'vitest'
import { fitWithin, prepareImage, validateImageFile } from './imageUpload'

// Only pure functions here; lib/supabase.ts throws without its settings (nightly B35).
vi.mock('./supabase', () => ({ supabase: {} }))

const file = (type: string, mb: number) => new File([new Uint8Array(Math.round(mb * 1024 * 1024))], 'x', { type })

describe('fitWithin', () => {
  it('scales the longer side down to the limit, keeping the shape', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 })
  })
  it('never scales a small image up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('validateImageFile', () => {
  it('lets big phone photos through (they are shrunk) but not big GIFs or logos', () => {
    expect(validateImageFile(file('image/jpeg', 12))).toBeNull()
    expect(validateImageFile(file('image/jpeg', 31))).toBe('tooLarge')
    expect(validateImageFile(file('image/gif', 6))).toBe('tooLarge')
    expect(validateImageFile(file('image/png', 6), false)).toBe('tooLarge')
    expect(validateImageFile(file('image/svg+xml', 1))).toBe('notImage')
  })
})

// No createImageBitmap under vitest: every file behaves like one the browser can't decode (nightly B36).
describe('prepareImage', () => {
  it('refuses at pick time what could not be uploaded later', async () => {
    expect((await prepareImage(file('image/jpeg', 12))).error).toBe('tooLarge')
    expect((await prepareImage(file('image/heic', 3))).error).toBe('notReadable')
    expect((await prepareImage(file('image/svg+xml', 1))).error).toBe('notImage')
  })
  it('accepts an undecodable file that already fits', async () => {
    expect((await prepareImage(file('image/jpeg', 2))).error).toBeNull()
  })
})
