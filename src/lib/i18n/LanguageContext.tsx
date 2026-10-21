import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { translations } from './translations'
import type { Language, TranslationKey } from './translations'

const STORAGE_KEY = 'touq-language'

type LanguageContextValue = {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey, vars?: Record<string, string>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function getInitialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'ar' ? 'ar' : 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage)

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  function setLanguage(lang: Language) {
    localStorage.setItem(STORAGE_KEY, lang)
    setLanguageState(lang)
  }

  function t(key: TranslationKey, vars?: Record<string, string>) {
    let text: string = translations[language][key] ?? translations.en[key] ?? key
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
