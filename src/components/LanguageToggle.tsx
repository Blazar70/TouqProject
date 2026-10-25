import { Globe } from 'lucide-react'
import { useLanguage } from '../lib/i18n/LanguageContext'

function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage()

  return (
    <button
      type="button"
      className="language-toggle-nav"
      onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
      aria-label={t('common.switchLanguage')}
    >
      <Globe className="species-icon" size={18} aria-hidden />
      {language === 'en' ? 'EN' : 'AR'}
    </button>
  )
}

export default LanguageToggle
