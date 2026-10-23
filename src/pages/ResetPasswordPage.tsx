import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import LanguageToggle from '../components/LanguageToggle'
import FormError from '../components/FormError'

// Shown instead of the normal app when Supabase's auth listener reports a
// PASSWORD_RECOVERY event (the user arrived via the "reset your password"
// email link) — see AuthContext. Setting a new password here clears that
// flag and drops them into the app normally, already signed in as
// themselves under the temporary recovery session.
function ResetPasswordPage() {
  const { clearPasswordRecovery } = useAuth()
  const { t } = useLanguage()
  const toast = useToast()

  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setError(error.message)
      setSubmitting(false)
      return
    }

    toast.success(t('auth.passwordResetDone'))
    clearPasswordRecovery()
  }

  return (
    <div className="login-page">
      <div className="login-brand-row">
        <h1>{t('auth.brand')}</h1>
        <LanguageToggle />
      </div>

      <h2>{t('auth.setNewPassword')}</h2>
      <form onSubmit={handleSubmit} className="login-form">
        <FormError message={error} />
        <label>
          {t('settings.newPassword')}
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={6}
            required
            autoFocus
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? t('common.saving') : t('auth.setNewPassword')}
        </button>
      </form>
    </div>
  )
}

export default ResetPasswordPage
