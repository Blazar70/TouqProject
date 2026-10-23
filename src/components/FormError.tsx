import { useEffect, useRef } from 'react'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { friendlyErrorKey } from '../lib/friendlyError'

// Errors often render far from the button that caused them (top of a long
// form), so bring each new message into view and announce it.
function FormError({ message }: { message: string | null | undefined }) {
  const { t } = useLanguage()
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (message) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [message])
  if (!message) return null
  const key = friendlyErrorKey(message)
  return (
    <p ref={ref} className="form-error" role="alert">
      {key ? t(key) : message}
    </p>
  )
}

export default FormError
