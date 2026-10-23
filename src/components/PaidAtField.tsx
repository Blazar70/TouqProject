import { useLanguage } from '../lib/i18n/LanguageContext'

function toLocalDateTimeInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Managers only: a payment is timed "now" unless they enter an earlier time for a late entry.
// '' = now. The DB ignores the time for everyone else (0066).
function PaidAtField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  if (!value) {
    return (
      <p className="paid-at-now">
        {t('payments.paidNow')}{' '}
        <button type="button" className="secondary-button" onClick={() => onChange(toLocalDateTimeInput(new Date()))}>
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
          max={toLocalDateTimeInput(new Date())}
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
