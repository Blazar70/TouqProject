import { describe, expect, it } from 'vitest'
import { translations } from './translations'

const en = translations.en as Record<string, string>
const ar = translations.ar as Record<string, string>
const placeholders = (text = '') => text.match(/\{\w+\}/g) ?? []
// Arabic-only plural forms (LanguageContext t() picks them with Intl.PluralRules).
const base = (key: string) => key.replace(/_(zero|two|few|many)$/, '')

describe('translations', () => {
  it('has an Arabic text for every English key', () => {
    expect(Object.keys(en).filter((key) => !(key in ar))).toEqual([])
  })

  it('has no Arabic key that English lacks, apart from plural forms', () => {
    expect(Object.keys(ar).filter((key) => !(base(key) in en))).toEqual([])
  })

  it('uses only placeholders the English text fills', () => {
    const wrong = Object.entries(ar).filter(([key, text]) => {
      const known = new Set([...placeholders(en[key]), ...placeholders(en[base(key).replace(/_one$/, '')])])
      return placeholders(text).some((p) => !known.has(p))
    })
    expect(wrong).toEqual([])
  })

  it('picks the Arabic forms the plural texts are written for', () => {
    const form = (n: number) => new Intl.PluralRules('ar').select(n)
    expect([1, 2, 3, 10, 11, 100].map(form)).toEqual(['one', 'two', 'few', 'few', 'many', 'other'])
  })
})
