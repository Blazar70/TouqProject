import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { translations } from './translations'
import type { Language, TranslationKey } from './translations'
import { setDisplayLanguage } from '../format'

const STORAGE_KEY = 'touq-language'

type LanguageContextValue = {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey, vars?: Record<string, string>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function getInitialLanguage(): Language {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage blocked (some private modes): fall back to the device language.
  }
  // A new device set to Arabic starts in Arabic (nightly H26); a saved choice always wins.
  return stored === 'ar' || (!stored && navigator.language.startsWith('ar')) ? 'ar' : 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage)
  setDisplayLanguage(language)

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  function setLanguage(lang: Language) {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // Not remembered after a reload, but the switch still works.
    }
    setLanguageState(lang)
  }

  function t(key: TranslationKey, vars?: Record<string, string>) {
    // "1 pet" not "1 pets": a `<key>_<form>` variant wins when this language has one. Arabic also has
    // _two and _few (3-10); its base text uses the singular noun, right for 11 and up.
    const form = vars?.count === undefined ? undefined : new Intl.PluralRules(language).select(Number(vars.count))
    const plural = form ? (translations[language] as Record<string, string>)[`${key}_${form}`] : undefined
    let text: string = plural ?? translations[language][key] ?? translations.en[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, v)
      }
    }
    return text
  }

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
