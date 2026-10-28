// Shared reception desks: sign out after 10 idle minutes (user 10-29; PDPL sets no number, 10 fits PCI/CIS's 15-or-less).
export const IDLE_LIMIT_MS = 10 * 60_000
export const IDLE_WARN_MS = 60_000
// localStorage, so activity in one tab keeps the others alive and a browser closed for 10+ minutes opens signed out.
export const LAST_ACTIVE_KEY = 'touq.lastActive'

export function idleState(lastActive: number, now: number): 'active' | 'warn' | 'out' {
  const idle = now - lastActive
  if (idle >= IDLE_LIMIT_MS) return 'out'
  if (idle >= IDLE_LIMIT_MS - IDLE_WARN_MS) return 'warn'
  return 'active'
}
