import { useLanguage } from '../lib/i18n/LanguageContext'
import PawLoader from './PawLoader'

function LoadingScreen() {
  const { t } = useLanguage()
  return (
    <div className="app-loading-screen">
      <span className="app-brand">{t('auth.brand')}</span>
      <PawLoader />
    </div>
  )
}

export default LoadingScreen
