import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { formatSaudiPhoneInput, isValidClinicPhone, isValidSaudiMobile, stripSaudiPrefix } from '../lib/phone'
import { APPOINTMENT_STATUSES, STATUS_LABEL_KEYS } from '../lib/appointmentStatus'
import { REMINDER_LEAD_OPTIONS, isPushSupported, needsHomeScreenInstall, hasActivePushSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/push'
import Ltr from '../components/Ltr'
import BranchesPanel from '../components/BranchesPanel'
import ClinicLogoField from '../components/ClinicLogoField'
import { toLatinDigits } from '../lib/arabicDigits'
import { getReceiptSize, setReceiptSize } from '../lib/printSize'
import type { ReceiptSize } from '../lib/printSize'
import { isValidVatNumber } from '../lib/invoiceMath'
import { formatMoney } from '../lib/format'
import { DEFAULT_VAT_RATE, priceWithVat, priceWithoutVat, updateVatFields } from '../lib/vat'
import type { VatFields } from '../lib/vat'
import FormError from '../components/FormError'
import VaccinesSettings from '../components/VaccinesSettings'
import WaiverTemplatesSettings from '../components/WaiverTemplatesSettings'

type Service = Database['public']['Tables']['services']['Row']

const EMPTY_VAT_FIELDS: VatFields = { pre: '', rate: String(DEFAULT_VAT_RATE), post: '' }

// price is stored pre-VAT, derived from the post-VAT field at 4 decimals so
// the post-VAT price shown is exactly what comes back after saving.
// null if either number is missing or out of range.
function parseServicePrices(fields: VatFields): { price: number; vat_rate: number } | null {
  const post = parseFloat(fields.post)
  const vatRate = parseFloat(fields.rate)
  if (Number.isNaN(post) || post < 0 || Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) return null
  return { price: priceWithoutVat(post, vatRate), vat_rate: vatRate }
}

const REMINDER_OFF = 'off'
const REMINDER_CUSTOM = 'custom'

function reminderSelectValue(minutes: number | null) {
  if (!minutes) return REMINDER_OFF
  const isPreset = REMINDER_LEAD_OPTIONS.some((opt) => opt.minutes === minutes)
  return isPreset ? String(minutes) : REMINDER_CUSTOM
}

function SettingsPage() {
  const { profile, refreshClinicName, clinicName: savedClinicName, clinicLogoUrl } = useAuth()
  const { t } = useLanguage()
  const toast = useToast()
  const isVet = profile?.role === 'vet'
  const isManager = isVet && profile?.clinic_role === 'manager'
  const { branches, pickable, isClinicManager, reload: reloadBranches } = useBranch()
  const [staffBranches, setStaffBranches] = useState<{ profile_id: string; branch_id: string }[]>([])

  // Only for the close-branch count ("N staff move to main").
  useEffect(() => {
    if (!isClinicManager) return
    supabase
      .from('staff_branches')
      .select('profile_id, branch_id')
      .then(({ data }) => setStaffBranches(data ?? []))
  }, [isClinicManager, branches])

  const [clinicName, setClinicName] = useState('')
  const [clinicPhone, setClinicPhone] = useState('')
  const [receiptSize, setReceiptSizeState] = useState<ReceiptSize>(getReceiptSize)
  const [savingClinic, setSavingClinic] = useState(false)
  const [clinicError, setClinicError] = useState<string | null>(null)
  const [vatNumber, setVatNumber] = useState('')
  const [maxDiscount, setMaxDiscount] = useState('10')
  const [savingBilling, setSavingBilling] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)

  const [services, setServices] = useState<Service[]>([])
  const [loadingServices, setLoadingServices] = useState(false)
  const [newServiceName, setNewServiceName] = useState('')
  const [newServicePrices, setNewServicePrices] = useState<VatFields>(EMPTY_VAT_FIELDS)
  const [addingService, setAddingService] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null)
  const [editServiceName, setEditServiceName] = useState('')
  const [editServicePrices, setEditServicePrices] = useState<VatFields>(EMPTY_VAT_FIELDS)
  const [savingServiceId, setSavingServiceId] = useState<string | null>(null)

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
  const [dosePush, setDosePush] = useState(profile?.inpatient_dose_push ?? true)
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
      .select('name, phone, vat_number, max_staff_discount_percent')
      .eq('id', profile.clinic_id)
      .single()
      .then(({ data }) => {
        if (data) {
          setClinicName(data.name)
          setClinicPhone(data.phone ?? '')
          setVatNumber(data.vat_number ?? '')
          setMaxDiscount(String(data.max_staff_discount_percent))
        }
      })
  }, [profile?.clinic_id])

  useEffect(() => {
    if (!profile?.clinic_id) return
    setLoadingServices(true)
    supabase
      .from('services')
      .select('*')
      .eq('clinic_id', profile.clinic_id)
      .order('name', { ascending: true })
      .then(({ data }) => {
        setServices(data ?? [])
        setLoadingServices(false)
      })
  }, [profile?.clinic_id])

  async function handleAddService(e: FormEvent) {
    e.preventDefault()
    setServiceError(null)
    if (!profile?.clinic_id) return

    const prices = parseServicePrices(newServicePrices)
    if (!newServiceName.trim() || !prices) {
      setServiceError(t('settings.serviceInvalid'))
      return
    }

    setAddingService(true)
    const { data, error } = await supabase
      .from('services')
      .insert({ clinic_id: profile.clinic_id, name: newServiceName.trim(), ...prices })
      .select('*')
      .single()
    if (error || !data) {
      setServiceError(error?.message ?? t('common.couldNotSave'))
      setAddingService(false)
      return
    }
    setServices((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewServiceName('')
    setNewServicePrices(EMPTY_VAT_FIELDS)
    setAddingService(false)
  }

  function startEditService(service: Service) {
    setEditingServiceId(service.id)
    setEditServiceName(service.name)
    setEditServicePrices({
      pre: service.price.toFixed(2),
      rate: String(service.vat_rate),
      post: priceWithVat(service.price, service.vat_rate).toFixed(2),
    })
  }

  async function handleSaveServiceEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingServiceId) return

    const prices = parseServicePrices(editServicePrices)
    if (!editServiceName.trim() || !prices) {
      toast.error(t('settings.serviceInvalid'))
      return
    }

    setSavingServiceId(editingServiceId)
    const { data, error } = await supabase
      .from('services')
      .update({ name: editServiceName.trim(), ...prices })
      .eq('id', editingServiceId)
      .select('*')
      .single()
    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      setSavingServiceId(null)
      return
    }
    setServices((current) => current.map((s) => (s.id === data.id ? data : s)).sort((a, b) => a.name.localeCompare(b.name)))
    setEditingServiceId(null)
    setSavingServiceId(null)
  }

  // Price with VAT (what the customer pays) + VAT %, shared by the add and edit
  // service forms; the pre-VAT price is shown, not typed.
  function renderServicePriceInputs(fields: VatFields, setFields: (fields: VatFields) => void) {
    const input = (field: 'rate' | 'post', max?: string) => (
      <input
        type="number"
        inputMode="decimal"
        className="no-spinner"
        dir="ltr"
        min="0"
        max={max}
        step="0.01"
        value={fields[field]}
        onChange={(e) => setFields(updateVatFields(fields, field, e.target.value))}
        required
      />
    )
    return (
      <>
        <label>
          {t('settings.priceAfterVat')}
          {input('post')}
        </label>
        <label>
          {t('settings.vatRate')}
          {input('rate', '100')}
        </label>
        <p className="vat-derived">
          {t('settings.priceBeforeVat')}: <Ltr>{fields.pre || '—'}</Ltr>
        </p>
      </>
    )
  }

  // The old mark is cleared first: the database allows one hospital night per clinic.
  async function handleHospitalNight(id: string) {
    const old = services.find((s) => s.hospital_night)
    setSavingServiceId(id || old?.id || null)
    const steps = [old && supabase.from('services').update({ hospital_night: false }).eq('id', old.id), id && supabase.from('services').update({ hospital_night: true }).eq('id', id)]
    for (const step of steps) {
      if (!step) continue
      const { error } = await step
      if (error) {
        toast.error(error.message)
        break
      }
    }
    // Re-read rather than assume: a failed step leaves the mark where the database has it.
    const { data } = await supabase.from('services').select('*').eq('clinic_id', profile!.clinic_id!).order('name', { ascending: true })
    if (data) setServices(data)
    setSavingServiceId(null)
  }

  async function handleToggleServiceActive(service: Service) {
    setSavingServiceId(service.id)
    const { data, error } = await supabase
      .from('services')
      .update({ active: !service.active })
      .eq('id', service.id)
      .select('*')
      .single()
    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      setSavingServiceId(null)
      return
    }
    setServices((current) => current.map((s) => (s.id === data.id ? data : s)))
    setSavingServiceId(null)
  }

  async function handleSaveClinic(e: FormEvent) {
    e.preventDefault()
    setClinicError(null)
    if (!profile?.clinic_id) return

    if (clinicPhone && !isValidClinicPhone(clinicPhone)) {
      setClinicError(t('settings.invalidClinicPhone'))
      return
    }

    setSavingClinic(true)
    const { error } = await supabase
      .from('clinics')
      .update({ name: clinicName, phone: clinicPhone || null })
      .eq('id', profile.clinic_id)
    if (error) {
      setClinicError(error.message)
      setSavingClinic(false)
      return
    }
    setSavingClinic(false)
    toast.success(t('settings.savedChanges'))
    refreshClinicName()
  }

  // Managers only; the DB refuses everyone else (0061).
  async function handleSaveBilling(e: FormEvent) {
    e.preventDefault()
    setBillingError(null)
    if (!profile?.clinic_id) return
    const vat = vatNumber.trim()
    const max = parseFloat(maxDiscount)
    if (vat && !isValidVatNumber(vat)) {
      setBillingError(t('settings.vatNumberInvalid'))
      return
    }
    if (Number.isNaN(max) || max < 0 || max > 100) {
      setBillingError(t('payments.invalidAmount'))
      return
    }
    setSavingBilling(true)
    const { error } = await supabase
      .from('clinics')
      .update({ vat_number: vat || null, max_staff_discount_percent: max })
      .eq('id', profile.clinic_id)
    setSavingBilling(false)
    if (error) {
      setBillingError(error.message)
      return
    }
    toast.success(t('settings.savedChanges'))
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
        inpatient_dose_push: dosePush,
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
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>

      {isVet && (
        <div className="settings-section">
          <div className="settings-intro">
            <h2>{t('settings.clinicInfo')}</h2>
            {!isManager && <p className="pet-owner">{t('settings.clinicInfoReadOnly')}</p>}
          </div>
          <div className="settings-body">
          {/* Managers only (0076); others see it read-only. */}
          <form onSubmit={handleSaveClinic} className="pet-form">
            <FormError message={clinicError} />
            <label>
              {t('settings.clinicName')}
              <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} readOnly={!isManager} required />
            </label>
            <label>
              {t('settings.clinicPhone')}
              <input value={clinicPhone} onChange={(e) => setClinicPhone(toLatinDigits(e.target.value))} readOnly={!isManager} dir="ltr" placeholder="+966 11 234 5678" />
            </label>
            {isManager && (
              <button type="submit" disabled={savingClinic}>
                {savingClinic ? t('common.saving') : t('common.saveChanges')}
              </button>
            )}
          </form>
          </div>
        </div>
      )}

      {isManager && (
        <div className="settings-section">
          <div className="settings-intro">
            <h2>{t('settings.billing')}</h2>
            <p className="pet-owner">{t('settings.billingHint')}</p>
          </div>
          <div className="settings-body">
            <form onSubmit={handleSaveBilling} className="pet-form">
              <FormError message={billingError} />
              <label>
                {t('settings.vatNumber')}
                <input
                  value={vatNumber}
                  onChange={(e) => setVatNumber(e.target.value.replace(/\D/g, ''))}
                  readOnly={!isClinicManager}
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={15}
                  placeholder="3XXXXXXXXXXXXX3"
                />
              </label>
              <label>
                {t('settings.maxDiscount')}
                <input
                  type="number"
                  className="no-spinner"
                  dir="ltr"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.01"
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                  readOnly={!isClinicManager}
                  required
                />
                <span className="pet-owner">{t('settings.maxDiscountHint')}</span>
              </label>
              {/* Clinic-wide: whole-clinic managers only (0076); branch managers see them read-only. */}
              {isClinicManager && (
                <button type="submit" disabled={savingBilling}>
                  {savingBilling ? t('common.saving') : t('common.saveChanges')}
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {isManager && profile.clinic_id && (
        <div className="settings-section">
          <div className="settings-intro">
            <h2>{t('settings.logo')}</h2>
            <p className="pet-owner">{t('settings.logoHint')}</p>
          </div>
          <div className="settings-body">
            <ClinicLogoField
              clinic={{ id: profile.clinic_id, name: savedClinicName ?? '', logo_url: clinicLogoUrl }}
              onSaved={refreshClinicName}
            />
          </div>
        </div>
      )}

      {isManager && profile.clinic_id && (
        <div className="settings-section">
          <div className="settings-intro">
            <h2>{t('settings.branches')}</h2>
            <p className="pet-owner">{t(isClinicManager ? 'settings.branchesHint' : 'settings.branchesHintOwn')}</p>
          </div>
          <div className="settings-body">
            <BranchesPanel
              clinicId={profile.clinic_id}
              branches={isClinicManager ? branches : pickable}
              staffBranches={staffBranches}
              canManage={isClinicManager}
              canEdit={(b) => isClinicManager || pickable.some((p) => p.id === b.id)}
              onChanged={reloadBranches}
            />
          </div>
        </div>
      )}

      {isVet && (
        <div className="settings-section">
          <div className="settings-intro">
            <h2>{t('settings.services')}</h2>
            <p className="pet-owner">{t('settings.servicesHint')}</p>
            <p className="pet-owner">{t('settings.vatHint')}</p>
          </div>
          <div className="settings-body">

          {loadingServices ? (
            <p>{t('common.loading')}</p>
          ) : services.length === 0 ? (
            <p>{t('settings.noServices')}</p>
          ) : (
            <ul className="pet-list data-table data-services">
              <li className="data-head" aria-hidden>
                <span>{t('list.service')}</span>
                <span className="data-num">{t('settings.priceAfterVat')}</span>
                <span className="data-num">{t('settings.priceBeforeVat')}</span>
                <span className="data-num">{t('settings.vatShort')}</span>
                <span />
              </li>
              {services.map((service) =>
                editingServiceId === service.id ? (
                  <li key={service.id} className="pet-list-item">
                    <form onSubmit={handleSaveServiceEdit} className="pet-form pet-form-grid">
                      <label>
                        {t('settings.serviceName')}
                        <input value={editServiceName} onChange={(e) => setEditServiceName(e.target.value)} required />
                      </label>
                      {renderServicePriceInputs(editServicePrices, setEditServicePrices)}
                      <div className="record-edit-actions">
                        <button type="submit" disabled={savingServiceId === service.id}>
                          {savingServiceId === service.id ? t('common.saving') : t('common.save')}
                        </button>
                        <button type="button" className="cancel-button" onClick={() => setEditingServiceId(null)}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={service.id} className="pet-list-item">
                    <div className="pet-row data-row">
                      <div className="data-cell-wide">
                        <strong className="data-strong">{service.name}</strong>{' '}
                        {!service.active && (
                          <span className="status-badge status-cancelled">{t('settings.serviceInactive')}</span>
                        )}
                      </div>
                      <span className="data-num service-price">
                        <Ltr>{formatMoney(priceWithVat(service.price, service.vat_rate))}</Ltr> {t('common.currency')}
                      </span>
                      <span className="data-num data-muted">
                        <span className="data-label">{t('settings.priceBeforeVat')}: </span>
                        <Ltr>{formatMoney(service.price)}</Ltr>
                      </span>
                      <span className="data-num data-muted">
                        <span className="data-label">{t('settings.vatShort')}: </span>
                        <Ltr>{`${service.vat_rate}%`}</Ltr>
                      </span>
                      <div className="record-actions data-end">
                        <button type="button" className="secondary-button" onClick={() => startEditService(service)}>
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleToggleServiceActive(service)}
                          disabled={savingServiceId === service.id}
                        >
                          {service.active ? t('settings.deactivateService') : t('settings.activateService')}
                        </button>
                      </div>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}

          {/* 0086: "Bill this stay" fills this service × nights. One per clinic. */}
          {services.length > 0 && (
            <label className="hospital-night-pick">
              {t('settings.hospitalNight')}
              <select
                value={services.find((s) => s.hospital_night)?.id ?? ''}
                onChange={(e) => handleHospitalNight(e.target.value)}
                disabled={!isManager || savingServiceId !== null}
              >
                <option value="">{t('settings.hospitalNightNone')}</option>
                {services
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <span className="pet-owner">{t('settings.hospitalNightHint')}</span>
            </label>
          )}

          <form onSubmit={handleAddService} className="pet-form pet-form-grid">
            <FormError message={serviceError} />
            <label>
              {t('settings.serviceName')}
              <input value={newServiceName} onChange={(e) => setNewServiceName(e.target.value)} required />
            </label>
            {renderServicePriceInputs(newServicePrices, setNewServicePrices)}
            <button type="submit" disabled={addingService}>
              {addingService ? t('common.saving') : t('settings.addService')}
            </button>
          </form>
          </div>
        </div>
      )}

      {isVet && profile?.clinic_id && (
        <div className="settings-section">
          <div className="settings-intro">
            <h2>{t('settings.vaccines')}</h2>
            <p className="pet-owner">{t(isManager ? 'settings.vaccinesHint' : 'settings.vaccinesHintReadOnly')}</p>
          </div>
          <div className="settings-body">
            <VaccinesSettings clinicId={profile.clinic_id} canEdit={isManager} />
          </div>
        </div>
      )}

      {isManager && profile?.clinic_id && (
        <div className="settings-section">
          <div className="settings-intro">
            <h2>{t('waivers.settingsTitle')}</h2>
            <p className="pet-owner">{t('waivers.settingsHint')}</p>
          </div>
          <div className="settings-body">
            <WaiverTemplatesSettings clinicId={profile.clinic_id} />
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-intro">
          <h2>{t('settings.account')}</h2>
        </div>
        <div className="settings-body">
        <form onSubmit={handleSaveAccount} className="pet-form">
          <FormError message={accountError} />
          <label>
            {t('settings.yourName')}
            {/* 0083: only a manager (Staff page) or the admin may rename clinic staff */}
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required readOnly={Boolean(profile?.clinic_id)} aria-describedby={profile?.clinic_id ? 'name-locked-note' : undefined} />
            {profile?.clinic_id && <span id="name-locked-note" className="data-muted">{t('settings.nameLockedNote')}</span>}
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
              />
            </div>
          </label>
          <button type="submit" disabled={savingAccount}>
            {savingAccount ? t('common.saving') : t('common.saveChanges')}
          </button>
        </form>

        <form onSubmit={handleChangePassword} className="pet-form">
          <h3>{t('settings.changePassword')}</h3>
          <FormError message={passwordError} />
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
      </div>

      {isVet && (
        <div className="settings-section">
          <div className="settings-intro">
            <h2>{t('settings.printing')}</h2>
            <p className="pet-owner">{t('settings.printingHint')}</p>
          </div>
          <div className="settings-body">
            <label className="pet-form">
              {t('settings.receiptSize')}
              <select
                value={receiptSize}
                onChange={(e) => {
                  const size = e.target.value as ReceiptSize
                  setReceiptSize(size)
                  setReceiptSizeState(size)
                  toast.success(t('settings.receiptSizeSaved'))
                }}
              >
                <option value="a4">{t('settings.receiptA4')}</option>
                <option value="80mm">{t('settings.receipt80mm')}</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {isVet && (
        <div className="settings-section">
          <div className="settings-intro">
            <h2>{t('settings.notifications')}</h2>
            <p className="pet-owner">{t('settings.notificationsHint')}</p>
          </div>
          <div className="settings-body">
          {needsHomeScreenInstall() ? (
            <div className="pet-owner">
              <p>{t('settings.pushInstallIntro')}</p>
              <ol>
                <li>{t('settings.pushInstallStep1')}</li>
                <li>{t('settings.pushInstallStep2')}</li>
                <li>{t('settings.pushInstallStep3')}</li>
              </ol>
            </div>
          ) : !isPushSupported() ? (
            <p className="pet-owner">{t('settings.pushNotSupported')}</p>
          ) : (
            <>
              <button type="button" className="secondary-button" onClick={handleTogglePush} disabled={togglingPush}>
                {togglingPush ? t('common.saving') : pushEnabled ? t('settings.disablePush') : t('settings.enablePush')}
              </button>

              {pushEnabled && (
                <form onSubmit={handleSaveNotifications} className="pet-form">
                  <FormError message={notificationsError} />
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
                  {/* Only doctors and nurses get inpatient dose pushes (0082); 0086 lets each switch them off. */}
                  {(profile?.clinic_role === 'doctor' || profile?.clinic_role === 'nurse') && (
                    <label className="checkbox-label">
                      <input type="checkbox" checked={dosePush} onChange={(e) => setDosePush(e.target.checked)} />
                      {t('settings.dosePush')}
                    </label>
                  )}
                  <button type="submit" disabled={savingNotifications}>
                    {savingNotifications ? t('common.saving') : t('common.saveChanges')}
                  </button>
                </form>
              )}
            </>
          )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SettingsPage
