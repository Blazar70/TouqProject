import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { signOutThisDevice } from '../lib/push'
import LanguageToggle from '../components/LanguageToggle'
import MfaSetup from '../components/MfaSetup'

function MfaPage({ step }: { step: 'enroll' | 'verify' }) {
  const { t } = useLanguage()
  const { recheckMfa } = useAuth()

  return (
    <div className="login-page">
      <div className="login-brand-row">
        <h1>{t('auth.brand')}</h1>
        <LanguageToggle />
      </div>
      <h2>{step === 'enroll' ? t('mfa.enrollTitle') : t('mfa.verifyTitle')}</h2>
      <MfaSetup mode={step} onDone={recheckMfa} />
      <button type="button" className="secondary-button" onClick={signOutThisDevice}>
        {t('nav.logout')}
      </button>
    </div>
  )
}

export default MfaPage
