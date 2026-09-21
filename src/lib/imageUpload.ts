export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export type ImageValidationError = 'notImage' | 'tooLarge'

export function validateImageFile(file: File): ImageValidationError | null {
  if (!file.type.startsWith('image/')) return 'notImage'
  if (file.size > MAX_IMAGE_BYTES) return 'tooLarge'
  return null
}
