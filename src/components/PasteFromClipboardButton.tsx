import { Clipboard } from 'lucide-react'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'

async function readImageFromClipboard(): Promise<File | null> {
  const items = await navigator.clipboard.read()
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith('image/'))
    if (imageType) {
      const blob = await item.getType(imageType)
      return new File([blob], `pasted.${imageType.split('/')[1] || 'png'}`, { type: imageType })
    }
  }
  return null
}

// A click-triggered alternative to Ctrl+V — reads whatever image is already
// on the clipboard directly via the Clipboard API, no keyboard shortcut to
// remember. Browsers that don't support/allow programmatic clipboard reads
// (or a denied permission) fall back to a toast pointing at Ctrl+V instead.
function PasteFromClipboardButton({ onFile, disabled }: { onFile: (file: File) => void; disabled?: boolean }) {
  const { t } = useLanguage()
  const toast = useToast()

  async function handleClick() {
    if (!navigator.clipboard?.read) {
      toast.error(t('petDetail.clipboardUnsupported'))
      return
    }
    try {
      const file = await readImageFromClipboard()
      if (file) onFile(file)
      else toast.error(t('petDetail.clipboardNoImage'))
    } catch {
      toast.error(t('petDetail.clipboardUnsupported'))
    }
  }

  return (
    <button type="button" className="secondary-button pet-photo-paste" onClick={handleClick} disabled={disabled}>
      <Clipboard size={15} aria-hidden />
      {t('petDetail.pasteFromClipboard')}
    </button>
  )
}

export default PasteFromClipboardButton
