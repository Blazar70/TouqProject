import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useLanguage } from './i18n/LanguageContext'

type ConfirmOptions = {
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmState = ConfirmOptions | null

// Destructive confirms (danger: true) gate the confirm button behind a
// short countdown — cheap insurance against a reflexive click on a delete
// dialog that looks identical to every other confirm dialog in the app.
const DANGER_DELAY_SECONDS = 3

const ConfirmContext = createContext<((message: string, options?: Partial<ConfirmOptions>) => Promise<boolean>) | null>(
  null,
)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage()
  const [state, setState] = useState<ConfirmState>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const resolver = useRef<(value: boolean) => void>(() => {})
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((message: string, options?: Partial<ConfirmOptions>) => {
    setState({ message, ...options })
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  useEffect(() => {
    if (!state?.danger) {
      setSecondsLeft(0)
      return
    }
    setSecondsLeft(DANGER_DELAY_SECONDS)
    const interval = setInterval(() => {
      setSecondsLeft((current) => (current <= 1 ? 0 : current - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [state])

  function handle(result: boolean) {
    setState(null)
    resolver.current(result)
  }

  const confirmDisabled = Boolean(state?.danger) && secondsLeft > 0

  // A disabled button can't receive autoFocus, so a fresh danger dialog
  // would otherwise open with nothing focused — land on Cancel instead
  // until the countdown clears, then move focus to Confirm.
  useEffect(() => {
    if (!state) return
    if (confirmDisabled) cancelButtonRef.current?.focus()
    else confirmButtonRef.current?.focus()
  }, [state, confirmDisabled])

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handle(false)
      return
    }
    // Minimal focus trap: only two focusable elements in this dialog, so
    // cycling Tab between them is enough to keep focus from leaking to
    // whatever's behind the backdrop.
    if (e.key === 'Tab') {
      e.preventDefault()
      const focusConfirm = document.activeElement === cancelButtonRef.current
      const target = focusConfirm && !confirmDisabled ? confirmButtonRef.current : cancelButtonRef.current
      target?.focus()
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="confirm-backdrop" onClick={() => handle(false)}>
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
            <p>{state.message}</p>
            <div className="record-edit-actions">
              <button
                ref={confirmButtonRef}
                type="button"
                className={state.danger ? 'delete-button' : 'primary-button'}
                onClick={() => handle(true)}
                disabled={confirmDisabled}
              >
                {state.confirmLabel ?? t('common.confirm')}
                {confirmDisabled ? ` (${secondsLeft})` : ''}
              </button>
              <button ref={cancelButtonRef} type="button" className="cancel-button" onClick={() => handle(false)}>
                {state.cancelLabel ?? t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx
}
