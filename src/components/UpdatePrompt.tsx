/// <reference types="vite-plugin-pwa/react" />
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useLanguage } from '../lib/i18n/LanguageContext'

const UPDATE_CHECK_MS = 60 * 60 * 1000

// A new deploy waits until the user reloads, so an open tablet never runs old
// code against new permissions without noticing. Clinic tablets stay open all
// day, so also check for a new version every hour.
function UpdatePrompt() {
  const { t } = useLanguage()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => registration.update(), UPDATE_CHECK_MS)
    },
  })

  if (!needRefresh) return null

  return (
    <div className="update-banner" role="status">
      <span>{t('update.available')}</span>
      <button type="button" onClick={() => updateServiceWorker(true)}>
        {t('update.reload')}
      </button>
    </div>
  )
}

export default UpdatePrompt
