import { Dog, Cat, Bird, Rabbit, Squirrel, Fish, Turtle, PawPrint } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from './i18n/translations'

export const POPULAR_SPECIES: { value: string; icon: LucideIcon }[] = [
  { value: 'Dog', icon: Dog },
  { value: 'Cat', icon: Cat },
  { value: 'Bird', icon: Bird },
  { value: 'Rabbit', icon: Rabbit },
  { value: 'Hamster', icon: Squirrel },
  { value: 'Fish', icon: Fish },
  { value: 'Reptile', icon: Turtle },
]

export function speciesIcon(species: string): LucideIcon {
  return POPULAR_SPECIES.find((s) => s.value.toLowerCase() === species.toLowerCase())?.icon ?? PawPrint
}

// Species values are stored in English regardless of UI language; this maps
// a known value to its translated display label. Custom ("Other…") species
// entered by a vet are returned as-is, since there's nothing to translate.
// "Female · Neutered"; only what was recorded (H67).
export function petSexText(t: (key: TranslationKey) => string, pet: { sex?: string | null; neutered?: boolean | null }): string {
  return [
    pet.sex === 'male' ? t('pets.sexMale') : pet.sex === 'female' ? t('pets.sexFemale') : null,
    pet.neutered === true ? t('pets.neuteredYes') : pet.neutered === false ? t('pets.neuteredNo') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function speciesLabel(t: (key: TranslationKey) => string, species: string): string {
  const known = POPULAR_SPECIES.some((s) => s.value === species)
  return known ? t(`species.${species}` as TranslationKey) : species
}
