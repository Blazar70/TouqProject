import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { signOutThisDevice } from '../lib/push'
import { IDLE_LIMIT_MS, LAST_ACTIVE_KEY, idleState } from '../lib/idleLogout'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

const readLast = () => {
  try {
    return Number(localStorage.getItem(LAST_ACTIVE_KEY)) || null
  } catch {
    return null
  }
}
const writeLast = (value: number | null) => {
  try {
    if (value === null) localStorage.removeItem(LAST_ACTIVE_KEY)
    else localStorage.setItem(LAST_ACTIVE_KEY, String(value))
  } catch {
    // storage blocked: the timer still runs in this tab from its own clock
  }
}

// Signs the device out after 10 idle minutes, with a one-minute warning (lib/idleLogout.ts).
function IdleLogout() {
  const { session, loading } = useAuth()
  const { t } = useLanguage()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  useEffect(() => {
    if (loading) return
    if (!session) {
      writeLast(null) // next sign-in starts fresh
      return
    }
    let last = readLast() ?? Date.now()
    if (idleState(last, Date.now()) === 'out') {
      signOutThisDevice()
      return
    }
    writeLast(last)

    function onActivity() {
      const now = Date.now()
      if (now - last < 10_000) return // throttle storage writes
      last = now
      writeLast(now)
    }
    function tick() {
      last = Math.max(last, readLast() ?? last) // another tab may have been used
      const now = Date.now()
      const state = idleState(last, now)
      if (state === 'out') signOutThisDevice()
      setSecondsLeft(state === 'warn' ? Math.ceil((last + IDLE_LIMIT_MS - now) / 1000) : null)
    }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const timer = window.setInterval(tick, 1000)
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
      window.clearInterval(timer)
      setSecondsLeft(null)
    }
  }, [loading, session])

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
