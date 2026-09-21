import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Database } from '../lib/database.types'
import { speciesIcon } from '../lib/species'

type Pet = Pick<Database['public']['Tables']['pets']['Row'], 'photo_url' | 'species' | 'name'>

function PetAvatar({ pet, size = 40 }: { pet: Pet; size?: number }) {
  const style = { width: size, height: size }
  const [showLightbox, setShowLightbox] = useState(false)

  useEffect(() => {
    if (!showLightbox) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowLightbox(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showLightbox])

  if (pet.photo_url) {
    return (
      <>
        <button
          type="button"
          className="pet-avatar-button"
          onClick={() => setShowLightbox(true)}
          aria-label={`View larger photo of ${pet.name}`}
        >
          <img src={pet.photo_url} alt={pet.name} className="pet-avatar" style={style} />
        </button>
        {showLightbox && (
          <div className="lightbox-backdrop" onClick={() => setShowLightbox(false)}>
            <button type="button" className="lightbox-close" onClick={() => setShowLightbox(false)} aria-label="Close">
              <X size={22} aria-hidden />
            </button>
            <img src={pet.photo_url} alt={pet.name} className="lightbox-image" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </>
    )
  }

  const Icon = speciesIcon(pet.species)
  return (
    <span className="pet-avatar pet-avatar-fallback" style={style}>
      <Icon size={Math.round(size * 0.55)} aria-hidden />
    </span>
  )
}

export default PetAvatar
