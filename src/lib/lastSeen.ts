import { supabase } from './supabase'

// Stale-while-revalidate (UI tip 6): coming back to a page shows the list as it was a moment ago at once,
// while the fresh one loads quietly. Keys carry the user id, and signing out empties it.
// shortcut: memory only, per tab, so a reload starts empty (pages then load as before); persist if that matters.
const store = new Map<string, unknown>()
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') store.clear()
})

export function lastSeen<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

export function remember(key: string, value: unknown) {
  store.set(key, value)
}
