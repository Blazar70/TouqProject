import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

// A generic click-to-enlarge thumbnail — the same lightbox pattern as
// PetAvatar, but for any photo URL (e.g. one attached to a medical record)
// rather than specifically a pet's own photo_url.
function PhotoThumbnail({ url, alt, size = 56 }: { url: string; alt: string; size?: number }) {
  const [showLightbox, setShowLightbox] = useState(false)

  useEffect(() => {
    if (!showLightbox) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowLightbox(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showLightbox])

  return (
    <>
      <button
        type="button"
        className="pet-avatar-button"
        onClick={() => setShowLightbox(true)}
        aria-label={alt}
      >
        <img src={url} alt={alt} className="pet-avatar" style={{ width: size, height: size }} />
      </button>
      {showLightbox && (
        <div className="lightbox-backdrop" onClick={() => setShowLightbox(false)}>
          <button type="button" className="lightbox-close" onClick={() => setShowLightbox(false)} aria-label="Close">
            <X size={22} aria-hidden />
          </button>
          <img src={url} alt={alt} className="lightbox-image" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

export default PhotoThumbnail
