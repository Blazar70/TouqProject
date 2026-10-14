import { supabase } from './supabase'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export type ImageValidationError = 'notImage' | 'tooLarge'

export function validateImageFile(file: File): ImageValidationError | null {
  if (!file.type.startsWith('image/')) return 'notImage'
  if (file.size > MAX_IMAGE_BYTES) return 'tooLarge'
  return null
}

// Uploads to the public pet-photos bucket. `pathWithoutExt` must start with
// the caller's clinic_id: the storage policies only allow writes to that folder.
export async function uploadPhoto(pathWithoutExt: string, file: File) {
  const path = `${pathWithoutExt}.${file.name.split('.').pop() || 'jpg'}`
  const bucket = supabase.storage.from('pet-photos')
  const { error } = await bucket.upload(path, file, { upsert: true, contentType: file.type })
  if (error) return { url: null, error: error.message }
  return { url: bucket.getPublicUrl(path).data.publicUrl, error: null }
}
