import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isValidMicrochip } from '../lib/microchip'
import { useLanguage } from '../lib/i18n/LanguageContext'

// H46: warns (never blocks, an old record may hold a typo) when the microchip is already on another pet of the clinic.
function MicrochipTaken({ microchip, petId }: { microchip: string; petId?: string }) {
  const { t } = useLanguage()
  const [other, setOther] = useState<{ id: string; name: string; pet_number: number | null } | null>(null)

  useEffect(() => {
    setOther(null)
    if (!isValidMicrochip(microchip)) return
    let live = true
    let request = supabase.from('pets').select('id, name, pet_number').is('deleted_at', null).eq('microchip', microchip)
    if (petId) request = request.neq('id', petId)
    request.limit(1).then(({ data }) => {
      if (live) setOther(data?.[0] ?? null)
    })
    return () => {
      live = false
    }
  }, [microchip, petId])

  if (!other) return null
  return (
    <span className="form-warning" role="status">
      {t('pets.microchipTaken', { name: other.name, number: String(other.pet_number ?? '') })}{' '}
      <Link to={`/pets/${other.id}`} target="_blank" rel="noopener">
        {t('pets.openPet')}
      </Link>
    </span>
  )
}

export default MicrochipTaken
