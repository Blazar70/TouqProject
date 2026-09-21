import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import LanguageToggle from '../components/LanguageToggle'

function LoginPage() {
  const { t } = useLanguage()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [sendingReset, setSendingReset] = useState(false)
  const [forgotError, setForgotError] = useState<string | null>(null)

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
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
      <div className="login-brand-row">
        <h1>{t('auth.brand')}</h1>
        <LanguageToggle />
      </div>

      {showForgotPassword ? (
        <form onSubmit={handleForgotPassword} className="login-form">
          <p className="pet-owner">{t('auth.forgotPasswordHint')}</p>
          {forgotError && <p className="form-error">{forgotError}</p>}
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
            {t('auth.email')}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>

          <label>
            {t('auth.password')}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" disabled={submitting}>
            {submitting ? t('common.saving') : t('auth.login')}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setForgotEmail(email)
              setShowForgotPassword(true)
            }}
          >
            {t('auth.forgotPassword')}
          </button>
        </form>
      )}
    </div>
  )
}

export default LoginPage
