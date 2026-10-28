import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

const STORAGE_KEY = 'touq-theme'

type Theme = 'light' | 'dark'

type ThemeContextValue = {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getStoredTheme(): Theme | null {
  // Storage can throw (blocked in some private modes); start on the system theme then.
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'dark' || stored === 'light' ? stored : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<Theme | null>(getStoredTheme)
  // A synchronous matchMedia() read at first render can be stale in some
  // Chrome contexts (observed: page paints light, but this read already
  // says dark — the toggle then computes its target off that stale value,
  // so the first click just corrects internal state with no visible
  // change, and it takes a second click to actually flip). Re-checking in
  // an effect runs after the browser has settled, and the change listener
  // keeps it live if the OS theme flips while the app is open.
  const [systemIsDark, setSystemIsDark] = useState(() => systemTheme() === 'dark')

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemIsDark(mql.matches)
    function handleChange(e: MediaQueryListEvent) {
      setSystemIsDark(e.matches)
    }
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  const theme: Theme = override ?? (systemIsDark ? 'dark' : 'light')

  useEffect(() => {
    function apply() {
      if (override) document.documentElement.setAttribute('data-theme', override)
      else document.documentElement.removeAttribute('data-theme')
    }
    apply()
    // Belt-and-suspenders: re-assert the attribute whenever the tab regains
    // focus/visibility. `override` itself isn't observed to change on
    // alt-tab, but Chrome's own "auto dark theme for web content" heuristic
    // (independent of our CSS) can re-evaluate and override the page's
    // rendered appearance around visibility changes — reapplying here wins
    // that fight back regardless of what actually triggers it.
    document.addEventListener('visibilitychange', apply)
    window.addEventListener('focus', apply)
    return () => {
      document.removeEventListener('visibilitychange', apply)
      window.removeEventListener('focus', apply)
    }
  }, [override])

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not remembered after a reload, but the switch still works.
    }
    setOverride(next)
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
