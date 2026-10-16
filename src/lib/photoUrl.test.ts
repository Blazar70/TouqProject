import { afterEach, describe, expect, it, vi } from 'vitest'

const createSignedUrl = vi.fn()
vi.mock('./supabase', () => ({ supabase: { storage: { from: () => ({ createSignedUrl }) } } }))

const { signPhotoUrl } = await import('./photoUrl')

describe('signPhotoUrl', () => {
  afterEach(() => {
    vi.useRealTimers()
    createSignedUrl.mockReset()
  })

  it('signs the path without the ?t= cache-buster, and reuses it until half its life', async () => {
    vi.useFakeTimers()
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'signed-1' } })
    expect(await signPhotoUrl('clinic/pet.jpg?t=1')).toBe('signed-1')
    expect(createSignedUrl).toHaveBeenCalledWith('clinic/pet.jpg', 3600)

    await signPhotoUrl('clinic/pet.jpg?t=1')
    expect(createSignedUrl).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(31 * 60 * 1000)
    await signPhotoUrl('clinic/pet.jpg?t=1')
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed signing', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { signedUrl: 'ok' } })
    expect(await signPhotoUrl('clinic/other.jpg')).toBeNull()
    expect(await signPhotoUrl('clinic/other.jpg')).toBe('ok')
  })
})
