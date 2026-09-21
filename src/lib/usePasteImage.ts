import { useEffect } from 'react'

// Listens for a pasted image (Ctrl+V from a screenshot, a copied file, etc.)
// anywhere on the page while `enabled`, so photo-upload areas don't require
// clicking into a specific focusable element first — matches how pasting
// images works in most chat/mail clients.
export function usePasteImage(onImage: (file: File) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return

    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            onImage(file)
            e.preventDefault()
          }
          break
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [onImage, enabled])
}
