import { useEffect, useState } from 'react'
import { useLanguage } from '../lib/i18n/LanguageContext'

function OfflineBanner() {
  const { t } = useLanguage()
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    function handleOnline() {
      setOnline(true)
    }
    function handleOffline() {
      setOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (online) return null

  return <div className="offline-banner">{t('common.offline')}</div>
}

export default OfflineBanner
