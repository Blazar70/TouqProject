import { describe, expect, it } from 'vitest'
import { Dog, PawPrint } from 'lucide-react'
import { speciesIcon, speciesLabel } from './species'

describe('speciesIcon', () => {
  it('matches a known species case-insensitively', () => {
    expect(speciesIcon('dog')).toBe(Dog)
    expect(speciesIcon('DOG')).toBe(Dog)
  })

  it('falls back to a generic paw icon for an unknown species', () => {
    expect(speciesIcon('Dragon')).toBe(PawPrint)
  })
})

describe('speciesLabel', () => {
  it('translates a known species via the provided t function', () => {
    const t = (key: string) => `translated:${key}`
    expect(speciesLabel(t, 'Dog')).toBe('translated:species.Dog')
  })

  it('returns a custom species value as-is, untranslated', () => {
    const t = (key: string) => `translated:${key}`
    expect(speciesLabel(t, 'Iguana')).toBe('Iguana')
  })
})
