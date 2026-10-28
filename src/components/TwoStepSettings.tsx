import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import { mfaRequired } from '../lib/mfa'
import MfaSetup from './MfaSetup'

// Settings > Two-step login: on/off for staff who aren't required to use it (0095).
function TwoStepSettings() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const required = mfaRequired(profile)
  const [factorId, setFactorId] = useState<string | null | undefined>(undefined)
  const [settingUp, setSettingUp] = useState(false)

  const load = useCallback(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => setFactorId(data?.totp[0]?.id ?? null))
  }, [])
  useEffect(load, [load])

  async function turnOff() {
    if (!factorId || !(await confirm(t('mfa.turnOffConfirm'), { danger: true, confirmLabel: t('mfa.turnOff') }))) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) return toast.error(error.message)
    toast.success(t('mfa.turnedOff'))
    load()
  }

  if (factorId === undefined) return null
  return (
    <div className="pet-form">
      <h3>{t('mfa.settingsTitle')}</h3>
      <p className="data-muted">{factorId ? t('mfa.isOn') : t('mfa.isOff')}</p>
      {factorId && !required && (
        <button type="button" className="delete-button" onClick={turnOff}>
          {t('mfa.turnOff')}
        </button>
      )}
      {!factorId && !settingUp && (
        <button type="button" onClick={() => setSettingUp(true)}>
          {t('mfa.turnOn')}
        </button>
      )}
      {!factorId && settingUp && (
        <MfaSetup
          mode="enroll"
          onDone={() => {
            setSettingUp(false)
            toast.success(t('mfa.turnedOn'))
            load()
          }}
        />
      )}
    </div>
  )
}

export default TwoStepSettings
