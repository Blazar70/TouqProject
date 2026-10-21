import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, ChevronDown, MapPin } from 'lucide-react'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'

// Apple-style pop-up button in the sidebar: shows the current branch, opens a
// menu above it with a checkmark on the current one.
function BranchMenu({ onPicked }: { onPicked?: () => void }) {
  const { t } = useLanguage()
  const { pickable, branchId, pick, branchName } = useBranch()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    itemRefs.current[Math.max(0, pickable.findIndex((b) => b.id === branchId))]?.focus()
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, pickable, branchId])

  function close() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!open) return
    if (e.key === 'Escape') {
      // Stop here so the sidebar drawer's own Escape handler doesn't close too.
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[]
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
  }

  return (
    <div className="branch-menu" ref={wrapRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="branch-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('branch.filter')}: ${branchName(branchId)}`}
        onClick={() => setOpen((v) => !v)}
      >
        <MapPin size={18} aria-hidden />
        <span className="branch-menu-name">{branchName(branchId)}</span>
        <ChevronDown className="branch-menu-chevron" size={16} aria-hidden />
      </button>
      {open && (
        <div className="branch-menu-list" role="menu" aria-label={t('branch.filter')}>
          {pickable.map((b, i) => (
            <button
              key={b.id}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              role="menuitemradio"
              aria-checked={b.id === branchId}
              className="branch-menu-item"
              onClick={() => {
                if (b.id !== branchId) pick(b.id)
                close()
                onPicked?.()
              }}
            >
              <Check className="branch-menu-check" size={16} aria-hidden />
              {branchName(b.id)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default BranchMenu
