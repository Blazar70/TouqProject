import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// pet-photos is private (0043). A stored photo_url is a storage path, maybe
// with ?t=<n> so a re-upload to the same path gets a new cache key.
const SIGNED_URL_SECONDS = 60 * 60
// Re-sign well before expiry so a long-open tab never renders a dead link.
const REUSE_MS = (SIGNED_URL_SECONDS / 2) * 1000

const cache = new Map<string, { url: Promise<string | null>; at: number }>()

export function signPhotoUrl(stored: string): Promise<string | null> {
  const hit = cache.get(stored)
  if (hit && Date.now() - hit.at < REUSE_MS) return hit.url

  const url = supabase.storage
    .from('pet-photos')
    .createSignedUrl(stored.split('?')[0], SIGNED_URL_SECONDS)
    .then(({ data }) => {
      if (!data) cache.delete(stored)
      return data?.signedUrl ?? null
    })
  cache.set(stored, { url, at: Date.now() })
  return url
}

export function useSignedPhotoUrl(stored: string | null) {
  const [signed, setSigned] = useState<{ stored: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!stored) return
    let cancelled = false
    signPhotoUrl(stored).then((url) => {
      if (!cancelled) setSigned({ stored, url })
    })
    return () => {
      cancelled = true
    }
  }, [stored])

  // Ignore a result left over from a previous photo while the new one signs.
  return stored && signed?.stored === stored ? signed.url : null
}
