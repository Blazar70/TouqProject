import { useSyncExternalStore } from 'react'

// "Install Touq" in Settings (user 10-28). Chrome/Edge fire beforeinstallprompt once, early in the page's
// life, so main.tsx imports this file at startup to catch it before Settings is ever opened.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let state: { prompt: InstallPromptEvent | null; justInstalled: boolean } = { prompt: null, justInstalled: false }
const listeners = new Set<() => void>()
const set = (next: typeof state) => {
  state = next
  listeners.forEach((l) => l())
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // keep the button in Settings instead of the browser's own pop-up bar
  set({ prompt: e as InstallPromptEvent, justInstalled: false })
})
window.addEventListener('appinstalled', () => set({ prompt: null, justInstalled: true }))

// Already running as the installed app (Home Screen icon or its own window).
export const isInstalledApp = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function useInstallState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export async function promptInstall() {
  const event = state.prompt
  if (!event) return
  await event.prompt()
  // The browser allows one prompt per event; a dismissed one waits for the next visit.
  const { outcome } = await event.userChoice
  set({ prompt: null, justInstalled: outcome === 'accepted' })
}
