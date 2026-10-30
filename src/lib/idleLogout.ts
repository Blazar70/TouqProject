// Shared reception desks: lock after 10 idle minutes (user 10-29; PDPL sets no number, 10 fits PCI/CIS's 15-or-less).
export const IDLE_LIMIT_MS = 10 * 60_000
// A form with unsaved typing gets longer (nightly B25): a doctor holding an animal shouldn't lose a half-written record.
export const IDLE_LIMIT_DIRTY_MS = 60 * 60_000
export const IDLE_WARN_MS = 60_000
// localStorage, so activity in one tab keeps the others alive and a browser closed for 10+ minutes opens signed out.
export const LAST_ACTIVE_KEY = 'touq.lastActive'
// '1' while the screen is locked, so every tab and a reload stay locked until the password is typed.
export const LOCKED_KEY = 'touq.locked'

export function idleState(lastActive: number, now: number, limit = IDLE_LIMIT_MS): 'active' | 'warn' | 'out' {
  const idle = now - lastActive
  if (idle >= limit) return 'out'
  if (idle >= limit - IDLE_WARN_MS) return 'warn'
  return 'active'
}

// Forms with unsaved changes (useUnsavedChangesWarning) and savers run just before the screen locks (SessionPage).
export const idleGuards = { dirtyForms: 0, savers: new Set<() => Promise<unknown>>() }
