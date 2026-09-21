import { Moon } from 'lucide-react'
import { useTheme } from '../lib/ThemeContext'
import { useLanguage } from '../lib/i18n/LanguageContext'

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const { t } = useLanguage()

  return (
    <button type="button" className="language-toggle-nav" onClick={toggleTheme} aria-label={t('theme.switch')}>
      <Moon className="species-icon" size={18} aria-hidden />
      {theme === 'dark' ? t('theme.dark') : t('theme.light')}
    </button>
  )
}

export default ThemeToggle
