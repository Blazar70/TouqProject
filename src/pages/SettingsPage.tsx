import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import { SAUDI_MOBILE_MAX_DIGITS, formatSaudiPhoneInput, isValidSaudiMobile, stripSaudiPrefix } from '../lib/phone'
import { APPOINTMENT_STATUSES, STATUS_LABEL_KEYS } from '../lib/appointmentStatus'
import { REMINDER_LEAD_OPTIONS, isPushSupported, hasActivePushSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/push'

const REMINDER_OFF = 'off'
const REMINDER_CUSTOM = 'custom'

function reminderSelectValue(minutes: number | null) {
  if (!minutes) return REMINDER_OFF
  const isPreset = REMINDER_LEAD_OPTIONS.some((opt) => opt.minutes === minutes)
  return isPreset ? String(minutes) : REMINDER_CUSTOM
}

function SettingsPage() {
  const { profile, refreshClinicName } = useAuth()
  const { t } = useLanguage()
  const toast = useToast()
  const isVet = profile?.role === 'vet'

  const [clinicName, setClinicName] = useState('')
  const [savingClinic, setSavingClinic] = useState(false)
  const [clinicError, setClinicError] = useState<string | null>(null)

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(stripSaudiPrefix(profile?.phone ?? null))
  const [savingAccount, setSavingAccount] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [pushEnabled, setPushEnabled] = useState(false)
  const [togglingPush, setTogglingPush] = useState(false)
  const [reminderLead, setReminderLead] = useState(reminderSelectValue(profile?.push_reminder_lead_minutes ?? null))
  const [customReminderMinutes, setCustomReminderMinutes] = useState(
    reminderSelectValue(profile?.push_reminder_lead_minutes ?? null) === REMINDER_CUSTOM
      ? String(profile?.push_reminder_lead_minutes)
      : '',
  )
  const [notifyStatuses, setNotifyStatuses] = useState<string[]>(profile?.push_notify_statuses ?? [])
  const [savingNotifications, setSavingNotifications] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)

  useEffect(() => {
    if (!isPushSupported()) return
    hasActivePushSubscription().then(setPushEnabled)
  }, [])

  useEffect(() => {
    if (!profile?.clinic_id) return
    supabase
      .from('clinics')
      .select('name')
      .eq('id', profile.clinic_id)
      .single()
      .then(({ data }) => {
        if (data) setClinicName(data.name)
      })
  }, [profile?.clinic_id])

  async function handleSaveClinic(e: FormEvent) {
    e.preventDefault()
    setClinicError(null)
    if (!profile?.clinic_id) return

    setSavingClinic(true)
    const { error } = await supabase.from('clinics').update({ name: clinicName }).eq('id', profile.clinic_id)
    if (error) {
      setClinicError(error.message)
      setSavingClinic(false)
      return
    }
    setSavingClinic(false)
    toast.success(t('settings.savedChanges'))
    refreshClinicName()
  }

  async function handleSaveAccount(e: FormEvent) {
    e.preventDefault()
    setAccountError(null)
    if (!profile) return

    if (phone && !isValidSaudiMobile(phone)) {
      setAccountError(t('registerPet.invalidPhone'))
      return
    }

    setSavingAccount(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, phone: phone ? `+966${phone}` : null })
      .eq('id', profile.id)
    if (error) {
      setAccountError(error.message)
      setSavingAccount(false)
      return
    }
    setSavingAccount(false)
    toast.success(t('settings.savedChanges'))
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)

    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPasswordError(error.message)
      setSavingPassword(false)
      return
    }
    setNewPassword('')
    setSavingPassword(false)
    toast.success(t('settings.passwordUpdated'))
  }

  async function handleTogglePush() {
    if (!profile) return
    setTogglingPush(true)
    try {
      if (pushEnabled) {
        await unsubscribeFromPush(profile.id)
        setPushEnabled(false)
      } else {
        await subscribeToPush(profile.id)
        setPushEnabled(true)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.pushToggleFailed'))
    }
    setTogglingPush(false)
  }

  function toggleNotifyStatus(status: string) {
    setNotifyStatuses((current) => (current.includes(status) ? current.filter((s) => s !== status) : [...current, status]))
  }

  async function handleSaveNotifications(e: FormEvent) {
    e.preventDefault()
    setNotificationsError(null)
    if (!profile) return

    let leadMinutes: number | null = null
    if (reminderLead === REMINDER_CUSTOM) {
      const parsed = parseInt(customReminderMinutes, 10)
      if (!parsed || parsed < 1) {
        setNotificationsError(t('settings.reminderInvalidMinutes'))
        return
      }
      leadMinutes = parsed
    } else if (reminderLead !== REMINDER_OFF) {
      leadMinutes = parseInt(reminderLead, 10)
    }

    setSavingNotifications(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        push_reminder_lead_minutes: leadMinutes,
        push_notify_statuses: notifyStatuses,
      })
      .eq('id', profile.id)
    if (error) {
      setNotificationsError(error.message)
      setSavingNotifications(false)
      return
    }
    setSavingNotifications(false)
    toast.success(t('settings.savedChanges'))
  }

  return (
    <div>
      <h1>{t('settings.title')}</h1>

      {isVet && (
        <div className="settings-section">
          <h2>{t('settings.clinicInfo')}</h2>
          <form onSubmit={handleSaveClinic} className="pet-form">
            {clinicError && <p className="form-error">{clinicError}</p>}
            <label>
              {t('settings.clinicName')}
              <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} required />
            </label>
            <button type="submit" disabled={savingClinic}>
              {savingClinic ? t('common.saving') : t('common.saveChanges')}
            </button>
          </form>
        </div>
      )}

      <div className="settings-section">
        <h2>{t('settings.account')}</h2>
        <form onSubmit={handleSaveAccount} className="pet-form">
          {accountError && <p className="form-error">{accountError}</p>}
          <label>
            {t('settings.yourName')}
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label>
            {t('settings.yourPhone')}
            <div className="phone-input">
              <span className="phone-prefix">+966</span>
              <input
                value={phone}
                onChange={(e) => setPhone(formatSaudiPhoneInput(e.target.value))}
                placeholder="5X-XXX-XXXX"
                dir="ltr"
                inputMode="numeric"
                maxLength={SAUDI_MOBILE_MAX_DIGITS}
              />
            </div>
          </label>
          <button type="submit" disabled={savingAccount}>
            {savingAccount ? t('common.saving') : t('common.saveChanges')}
          </button>
        </form>

        <form onSubmit={handleChangePassword} className="pet-form">
          <h3>{t('settings.changePassword')}</h3>
          {passwordError && <p className="form-error">{passwordError}</p>}
          <label>
            {t('settings.newPassword')}
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          <button type="submit" disabled={savingPassword}>
            {savingPassword ? t('common.saving') : t('settings.changePassword')}
          </button>
        </form>
      </div>

      {isVet && (
        <div className="settings-section">
          <h2>{t('settings.notifications')}</h2>
          {!isPushSupported() ? (
            <p className="pet-owner">{t('settings.pushNotSupported')}</p>
          ) : (
            <>
              <button type="button" className="secondary-button" onClick={handleTogglePush} disabled={togglingPush}>
                {togglingPush ? t('common.saving') : pushEnabled ? t('settings.disablePush') : t('settings.enablePush')}
              </button>

              {pushEnabled && (
                <form onSubmit={handleSaveNotifications} className="pet-form">
                  {notificationsError && <p className="form-error">{notificationsError}</p>}
                  <label>
                    {t('settings.reminderLead')}
                    <select value={reminderLead} onChange={(e) => setReminderLead(e.target.value)}>
                      <option value={REMINDER_OFF}>{t('settings.reminderOff')}</option>
                      {REMINDER_LEAD_OPTIONS.map((opt) => (
                        <option key={opt.minutes} value={opt.minutes}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                      <option value={REMINDER_CUSTOM}>{t('settings.reminderCustom')}</option>
                    </select>
                  </label>
                  {reminderLead === REMINDER_CUSTOM && (
                    <label>
                      {t('settings.reminderCustomMinutes')}
                      <div className="custom-interval">
                        <input
                          type="number"
                          dir="ltr"
                          min={1}
                          value={customReminderMinutes}
                          onChange={(e) => setCustomReminderMinutes(e.target.value)}
                          required
                        />
                        <span>{t('settings.minutesBefore')}</span>
                      </div>
                    </label>
                  )}
                  <fieldset className="checkbox-group">
                    <legend>{t('settings.notifyOnStatus')}</legend>
                    {APPOINTMENT_STATUSES.map((status) => (
                      <label key={status} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={notifyStatuses.includes(status)}
                          onChange={() => toggleNotifyStatus(status)}
                        />
                        {t(STATUS_LABEL_KEYS[status])}
                      </label>
                    ))}
                  </fieldset>
                  <button type="submit" disabled={savingNotifications}>
                    {savingNotifications ? t('common.saving') : t('common.saveChanges')}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default SettingsPage
