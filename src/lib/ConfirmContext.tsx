import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useLanguage } from './i18n/LanguageContext'

type ConfirmOptions = {
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  // Irreversible actions (H51): the confirm button stays off until this exact text is typed, e.g. a clinic's name.
  typeToConfirm?: string
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
  const [typed, setTyped] = useState('')
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const typeInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const confirm = useCallback((message: string, options?: Partial<ConfirmOptions>) => {
    setState({ message, ...options })
    setTyped('')
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

  const confirmDisabled =
    (Boolean(state?.danger) && secondsLeft > 0) || (state?.typeToConfirm !== undefined && typed.trim() !== state.typeToConfirm)

  // Destructive dialogs open (and stay) on Cancel so a stray Enter never deletes.
  useEffect(() => {
    if (!state) return
    if (state.typeToConfirm !== undefined) typeInputRef.current?.focus()
    else if (state.danger) cancelButtonRef.current?.focus()
    else confirmButtonRef.current?.focus()
  }, [state])

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Only this dialog: a Modal underneath listens for Escape on document.
      e.stopPropagation()
      handle(false)
      return
    }
    // Focus trap: Tab and Shift+Tab cycle through the dialog's own controls (a disabled button is skipped).
    if (e.key === 'Tab') {
      e.preventDefault()
      const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])]
      const next = items.indexOf(document.activeElement as HTMLElement) + (e.shiftKey ? -1 : 1)
      items[(next + items.length) % items.length]?.focus()
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="confirm-backdrop" onClick={() => handle(false)}>
          <div ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-describedby="confirm-message" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
            <p id="confirm-message">{state.message}</p>
            {state.typeToConfirm !== undefined && (
              <label className="confirm-type">
                {t('confirm.typeToConfirm', { text: state.typeToConfirm })}
                <input ref={typeInputRef} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} dir="auto" />
              </label>
            )}
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
