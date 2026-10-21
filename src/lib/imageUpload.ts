import { supabase } from './supabase'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const CLINIC_LOGOS_BUCKET = 'clinic-logos'

export type ImageValidationError = 'notImage' | 'tooLarge'

export function validateImageFile(file: File): ImageValidationError | null {
  // SVG can carry script; storage refuses it too (0055).
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return 'notImage'
  if (file.size > MAX_IMAGE_BYTES) return 'tooLarge'
  return null
}

// Uploads to the private pet-photos bucket (or the given one) and returns the
// storage path to save in photo_url / logo_url. `pathWithoutExt` must start
// with the clinic_id: the storage policies only allow writes to that folder.
export async function uploadPhoto(pathWithoutExt: string, file: File, bucketId = 'pet-photos') {
  const path = `${pathWithoutExt}.${file.name.split('.').pop() || 'jpg'}`
  const bucket = supabase.storage.from(bucketId)
  const { error } = await bucket.upload(path, file, { upsert: true, contentType: file.type })
  if (error) return { path: null, error: error.message }
  return { path, error: null }
}

// clinic-logos is public (0053); a stored logo_url is "<path>?t=<n>".
export function clinicLogoUrl(stored: string) {
  const [path, query] = stored.split('?')
  const url = supabase.storage.from(CLINIC_LOGOS_BUCKET).getPublicUrl(path).data.publicUrl
  return query ? `${url}?${query}` : url
}
