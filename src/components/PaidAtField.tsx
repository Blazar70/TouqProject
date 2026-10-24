import { useLanguage } from '../lib/i18n/LanguageContext'
import { isoToClinicFields } from '../lib/timeOff'

// Clinic (Riyadh) wall time, whatever the device's time zone (nightly B11).
function clinicNowInput() {
  const { date, time } = isoToClinicFields(new Date().toISOString())
  return `${date}T${time}`
}

// Managers only: a payment is timed "now" unless they enter an earlier time for a late entry.
// '' = now; a value is clinic time. The DB ignores the time for everyone else (0066).
function PaidAtField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  if (!value) {
    return (
      <p className="paid-at-now">
        {t('payments.paidNow')}{' '}
        <button type="button" className="secondary-button" onClick={() => onChange(clinicNowInput())}>
          {t('payments.changeTime')}
        </button>
      </p>
    )
  }
  return (
    <label>
      {t('payments.paidAt')}
      <span className="paid-at-edit">
        <input
          type="datetime-local"
          dir="ltr"
          value={value}
          max={clinicNowInput()}
          onChange={(e) => onChange(e.target.value)}
          required
        />
        <button type="button" className="secondary-button" onClick={() => onChange('')}>
          {t('payments.useNow')}
        </button>
      </span>
    </label>
  )
}

export default PaidAtField
