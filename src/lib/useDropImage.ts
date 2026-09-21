import { useState } from 'react'
import type { DragEvent } from 'react'

// Drag-and-drop from Explorer/Finder straight onto a photo area — the other
// way (besides Ctrl+V and the file input) a browser lets a page receive a
// file without a system file-picker dialog.
export function useDropImage(onFile: (file: File) => void, enabled = true) {
  const [dragActive, setDragActive] = useState(false)

  function stop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  const dragHandlers = enabled
    ? {
        onDragEnter: (e: DragEvent) => {
          stop(e)
          setDragActive(true)
        },
        onDragOver: (e: DragEvent) => {
          stop(e)
          setDragActive(true)
        },
        onDragLeave: (e: DragEvent) => {
          stop(e)
          setDragActive(false)
        },
        onDrop: (e: DragEvent) => {
          stop(e)
          setDragActive(false)
          const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
          if (file) onFile(file)
        },
      }
    : {}

  return { dragActive, dragHandlers }
}
