import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Database } from './database.types'

type Pet = Database['public']['Tables']['pets']['Row']

// Pets the picker just showed, so picking one renders at once; the fetch below still refreshes it.
const seen = new Map<string, Pet>()
export function rememberPets(pets: Pet[]) {
  pets.forEach((pet) => seen.set(pet.id, pet))
}

// One pet by id (forms that hold only a pet id since lists stopped loading every pet, nightly B29).
// undefined while loading, null when there is no such (live) pet.
export function usePet(id: string): Pet | null | undefined {
  const [result, setResult] = useState<{ id: string; pet: Pet | null } | null>(null)
  useEffect(() => {
    if (!id) return
    let live = true
    supabase
      .from('pets')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
      .then(({ data }) => {
        if (data) seen.set(id, data)
        if (live) setResult({ id, pet: data ?? null })
      })
    return () => {
      live = false
    }
  }, [id])
  if (!id) return null
  return result?.id === id ? result.pet : seen.get(id)
}
