import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

// Pop-up card: dialog role, Escape and backdrop click close it, focus moves in
// on open and goes back to whatever opened it on close.
function Modal({
  onClose,
  labelledBy,
  className,
  children,
}: {
  onClose: () => void
  labelledBy: string
  className?: string
  children: ReactNode
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    cardRef.current?.focus()
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      opener?.focus()
    }
  }, [])

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div
        ref={cardRef}
        className={`admin-modal-card${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export default Modal
