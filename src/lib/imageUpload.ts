import { supabase } from './supabase'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
// Phone photos and X-ray exports are often bigger: these types are shrunk before upload (H50), so they may start larger.
const SHRINKABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const MAX_SOURCE_BYTES = 30 * 1024 * 1024
const MAX_SIDE = 2000

export const CLINIC_LOGOS_BUCKET = 'clinic-logos'

export type ImageValidationError = 'notImage' | 'tooLarge'

// `shrinks: false` for files uploaded as they are (clinic logos keep their transparent PNG).
export function validateImageFile(file: File, shrinks = true): ImageValidationError | null {
  // SVG can carry script; storage refuses it too (0055).
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return 'notImage'
  if (file.size > (shrinks && SHRINKABLE.includes(file.type) ? MAX_SOURCE_BYTES : MAX_IMAGE_BYTES)) return 'tooLarge'
  return null
}

// Width and height scaled down (never up) so the longer side is at most `max`.
export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// Photos as a ~2000 px JPEG (H50): a 4 MB phone photo becomes a few hundred KB, faster on clinic Wi-Fi.
// Small files, GIFs and anything the browser can't decode (HEIC outside Safari) go up unchanged.
export async function shrinkImage(file: File): Promise<File> {
  if (!SHRINKABLE.includes(file.type) || file.size <= 700 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff' // a transparent PNG would turn black in a JPEG
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// Uploads to the private pet-photos bucket (or the given one) and returns the
// storage path to save in photo_url / logo_url. `pathWithoutExt` must start
// with the clinic_id: the storage policies only allow writes to that folder.
export async function uploadPhoto(pathWithoutExt: string, original: File, bucketId = 'pet-photos') {
  const file = bucketId === CLINIC_LOGOS_BUCKET ? original : await shrinkImage(original)
  if (file.size > MAX_IMAGE_BYTES) return { path: null, error: 'tooLarge' as const }
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
