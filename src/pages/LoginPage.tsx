import { useEffect, useState } from 'react'
import { PawPrint } from 'lucide-react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import LanguageToggle from '../components/LanguageToggle'
import { usernameToEmail } from '../../supabase/functions/_shared/staffRules'
import FormError from '../components/FormError'

function LoginPage() {
  const { t } = useLanguage()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // An expired/used reset email link lands here with ?error_code= or #error_code= (Supabase auth).
  const [linkExpired] = useState(() => /[#?&]error_code=/.test(window.location.hash + window.location.search))
  const [showForgotPassword, setShowForgotPassword] = useState(linkExpired)
  const [forgotEmail, setForgotEmail] = useState('')
  const [sendingReset, setSendingReset] = useState(false)
  const [forgotError, setForgotError] = useState<string | null>(linkExpired ? t('errors.resetLinkExpired') : null)
  useEffect(() => {
    if (linkExpired) window.history.replaceState(null, '', window.location.pathname)
  }, [linkExpired])

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    // Staff sign in with a username; their auth email is derived from it (0047).
    const login = email.trim()
    const { error } = await supabase.auth.signInWithPassword({
      email: login.includes('@') ? login : usernameToEmail(login.toLowerCase()),
      password,
    })
    // Removed staff are banned in auth (clinic-manage-staff set_disabled).
    if (error) setError(error.code === 'user_banned' ? t('admin.accountDisabledBody') : error.message)
    setSubmitting(false)
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault()
    setForgotError(null)
    setSendingReset(true)

    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, { redirectTo: window.location.origin })
    if (error) {
      setForgotError(error.message)
      setSendingReset(false)
      return
    }

    toast.success(t('auth.resetEmailSent'))
    setShowForgotPassword(false)
    setSendingReset(false)
    setForgotEmail('')
  }

  return (
    <div className="login-page">
      <div className="login-card">
      <span className="login-brand-mark" aria-hidden>
        <PawPrint size={26} />
      </span>
      <div className="login-brand-row">
        <h1>{t('auth.brand')}</h1>
        <LanguageToggle />
      </div>

      {showForgotPassword ? (
        <form onSubmit={handleForgotPassword} className="login-form">
          <p className="pet-owner">{t('auth.forgotPasswordHint')}</p>
          <FormError message={forgotError} />
          <label>
            {t('auth.email')}
            <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required autoFocus />
          </label>
          <button type="submit" disabled={sendingReset}>
            {sendingReset ? t('common.saving') : t('auth.sendResetLink')}
          </button>
          <button type="button" className="secondary-button" onClick={() => setShowForgotPassword(false)}>
            {t('common.back')}
          </button>
        </form>
      ) : (
        <form onSubmit={handleLogin} className="login-form">
          <label>
            {t('auth.usernameOrEmail')}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              required
            />
          </label>

          <label>
            {t('auth.password')}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>

          <FormError message={error} />

          <button type="submit" disabled={submitting}>
            {submitting ? t('common.saving') : t('auth.login')}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setForgotEmail(email.includes('@') ? email : '')
              setShowForgotPassword(true)
            }}
          >
            {t('auth.forgotPassword')}
          </button>
        </form>
      )}
      </div>
    </div>
  )
}

export default LoginPage
