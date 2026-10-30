import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { supabase } from '../lib/supabase'
import { IDLE_LIMIT_DIRTY_MS, IDLE_LIMIT_MS, LAST_ACTIVE_KEY, LOCKED_KEY, idleGuards, idleState } from '../lib/idleLogout'
import FormError from './FormError'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

// Storage can be blocked: the timer still runs in this tab from its own clock.
const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // see above
  }
}
const readLast = () => Number(read(LAST_ACTIVE_KEY)) || null
const isLockedStored = () => read(LOCKED_KEY) === '1'

// Locks the screen after 10 idle minutes (60 with unsaved typing), with a one-minute warning (lib/idleLogout.ts).
// A lock, not a sign-out (user 10-29): the session, push alerts and the dashboard's own reload keep running behind
// it, so a front-desk tablet stays useful; the password opens it again. The lock is shared by every tab.
function IdleLogout() {
  const { session, loading, profile } = useAuth()
  const { t } = useLanguage()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!session) {
      write(LAST_ACTIVE_KEY, null) // next sign-in starts fresh
      write(LOCKED_KEY, null)
      setLocked(false)
      return
    }
    let last = readLast() ?? Date.now()
    let isLocked = false
    function lock() {
      isLocked = true
      write(LOCKED_KEY, '1')
      setLocked(true)
      setSecondsLeft(null)
      idleGuards.savers.forEach((save) => save().catch(() => undefined))
    }
    // Reopened after 10+ idle minutes, or another tab is locked.
    if (isLockedStored() || idleState(last, Date.now()) === 'out') lock()
    else write(LAST_ACTIVE_KEY, String(last))

    function onActivity() {
      const now = Date.now()
      if (isLocked || now - last < 10_000) return // typing the password isn't activity; throttle storage writes
      last = now
      write(LAST_ACTIVE_KEY, String(now))
    }
    function tick() {
      if (isLockedStored() !== isLocked) {
        // another tab locked or unlocked
        if (isLocked) {
          isLocked = false
          last = readLast() ?? Date.now()
          setLocked(false)
        } else lock()
      }
      if (isLocked) return
      last = Math.max(last, readLast() ?? last) // another tab may have been used
      const now = Date.now()
      const limit = idleGuards.dirtyForms > 0 ? IDLE_LIMIT_DIRTY_MS : IDLE_LIMIT_MS
      const state = idleState(last, now, limit)
      if (state === 'out') lock()
      else setSecondsLeft(state === 'warn' ? Math.ceil((last + limit - now) / 1000) : null)
    }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const timer = window.setInterval(tick, 1000)
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
      window.clearInterval(timer)
      setSecondsLeft(null)
    }
  }, [loading, session])

  // Keyboard and screen readers can't reach the app behind the lock.
  useEffect(() => {
    document.getElementById('root')?.toggleAttribute('inert', locked)
    if (!locked) {
      setPassword('')
      setError(null)
    }
  }, [locked])

  async function handleUnlock(e: FormEvent) {
    e.preventDefault()
    if (!session?.user.email) return
    setUnlocking(true)
    setError(null)
    // Same user signing in again: AuthContext keys the profile on the user id, so nothing reloads.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: session.user.email, password })
    setUnlocking(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    write(LAST_ACTIVE_KEY, String(Date.now()))
    write(LOCKED_KEY, null)
    setLocked(false)
  }

  if (locked) {
    return createPortal(
      <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title">
        <form className="lock-card pet-form" onSubmit={handleUnlock}>
          <h2 id="lock-title">{t('idle.lockedTitle')}</h2>
          <p className="pet-owner">{t('idle.lockedHint', { name: profile?.full_name ?? '' })}</p>
          <FormError message={error} />
          <label>
            {t('auth.password')}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </label>
          <button type="submit" disabled={unlocking}>
            {unlocking ? t('idle.unlocking') : t('idle.unlock')}
          </button>
          {/* Session only, like the old idle sign-out: this device keeps its alerts (nightly B24). */}
          <button type="button" className="secondary-button" onClick={() => supabase.auth.signOut({ scope: 'local' })}>
            {t('idle.notYou')}
          </button>
        </form>
      </div>,
      document.body,
    )
  }
  if (secondsLeft === null) return null
  return (
    <div className="confirm-backdrop">
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-describedby="idle-message">
        <p id="idle-message">{t('idle.warning', { seconds: String(secondsLeft) })}</p>
        <div className="record-edit-actions">
          {/* the click itself counts as activity and closes this on the next tick */}
          <button type="button" className="primary-button" autoFocus>
            {t('idle.stay')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default IdleLogout
