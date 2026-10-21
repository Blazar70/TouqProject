import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'

// invoices.payment_status (kept by the database, 0061) as a pill.
const STATUS: Record<string, { key: TranslationKey; className: string }> = {
  unpaid: { key: 'payments.statusUnpaid', className: 'status-requested' },
  partly_paid: { key: 'payments.statusPartlyPaid', className: 'status-confirmed' },
  paid: { key: 'payments.statusPaid', className: 'status-completed' },
}

function PaymentStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage()
  const s = STATUS[status] ?? STATUS.unpaid
  return <span className={`status-badge ${s.className}`}>{t(s.key)}</span>
}

export default PaymentStatusBadge
