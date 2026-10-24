import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useLanguage } from './i18n/LanguageContext'
import { friendlyErrorKey } from './friendlyError'

type ToastType = 'success' | 'error'
type ToastAction = { label: string; onClick: () => void }
type Toast = { id: number; type: ToastType; message: string; action?: ToastAction }

type ToastContextValue = {
  // An action (e.g. Undo) keeps the toast up longer so there is time to reach it.
  success: (message: string, action?: ToastAction) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const AUTO_DISMISS_MS = 4000
const ACTION_DISMISS_MS = 6000

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage()
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const schedule = useCallback(
    (id: number, ms = AUTO_DISMISS_MS) => {
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ms),
      )
    },
    [dismiss],
  )

  const push = useCallback(
    (type: ToastType, message: string, action?: ToastAction) => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, type, message, action }])
      schedule(id, action ? ACTION_DISMISS_MS : AUTO_DISMISS_MS)
    },
    [schedule],
  )

  // Hovering a toast (to read a longer error message, say) shouldn't let it
  // vanish mid-read — pause the timer while the cursor is over it, restart
  // it fresh once the cursor leaves.
  function handleMouseEnter(id: number) {
    clearTimeout(timers.current.get(id))
  }

  function handleMouseLeave(toast: Toast) {
    schedule(toast.id, toast.action ? ACTION_DISMISS_MS : AUTO_DISMISS_MS)
  }

  const value: ToastContextValue = {
    success: (message, action) => push('success', message, action),
    error: (message) => {
      const key = friendlyErrorKey(message)
      push('error', key ? t(key) : message)
    },
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Always mounted so screen readers announce toasts added later. */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : undefined}
            className={`toast toast-${toast.type}`}
            onClick={() => dismiss(toast.id)}
            onMouseEnter={() => handleMouseEnter(toast.id)}
            onMouseLeave={() => handleMouseLeave(toast)}
            // Keyboard users tabbing to the action get the same pause as a hovering mouse.
            onFocus={() => handleMouseEnter(toast.id)}
            onBlur={() => handleMouseLeave(toast)}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 size={18} aria-hidden />
            ) : (
              <XCircle size={18} aria-hidden />
            )}
            <span>{toast.message}</span>
            {toast.action && (
              // The toast's own click dismisses it, so the action runs and the toast closes in one click.
              <button type="button" className="toast-action" onClick={toast.action.onClick}>
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
