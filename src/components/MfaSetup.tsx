import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { toLatinDigits } from '../lib/arabicDigits'
import FormError from './FormError'
import Ltr from './Ltr'

// Set up a code app (enroll) or type the current code (verify). onDone runs once the session is at aal2.
function MfaSetup({ mode, onDone }: { mode: 'enroll' | 'verify'; onDone: () => void }) {
  const { t } = useLanguage()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState<{ image: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice; one enrollment only
    started.current = true
    ;(async () => {
      const { data: list, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) return setError(listError.message)
      if (mode === 'verify') {
        const factor = list.totp[0]
        return factor ? setFactorId(factor.id) : setError(t('mfa.noFactor'))
      }
      // A set-up started earlier and never finished blocks a new one: clear it.
      for (const f of list.all.filter((f) => f.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id })
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Touq' })
      if (error) return setError(error.message)
      setFactorId(data.id)
      setQr({ image: data.totp.qr_code, secret: data.totp.secret })
    })()
  }, [mode, t])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: toLatinDigits(code).trim() })
    setBusy(false)
    if (error) {
      setError(t('mfa.wrongCode'))
      setCode('')
      return
    }
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="login-form">
      {mode === 'enroll' && (
        <>
          <p>{t('mfa.enrollSteps')}</p>
          {qr && (
            <>
              <img src={qr.image} alt={t('mfa.qrAlt')} className="mfa-qr" width={180} height={180} />
              <p className="data-muted">
                {t('mfa.manualKey')} <Ltr>{qr.secret}</Ltr>
              </p>
            </>
          )}
        </>
      )}
      <label>
        {t('mfa.code')}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9٠-٩]{6}"
          maxLength={6}
          dir="ltr"
          required
          autoFocus={mode === 'verify'}
        />
      </label>
      <FormError message={error} />
      <button type="submit" disabled={busy || !factorId}>
        {busy ? t('common.saving') : t('mfa.confirm')}
      </button>
    </form>
  )
}

export default MfaSetup
