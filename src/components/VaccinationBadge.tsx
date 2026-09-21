import { vaccinationStatus, vaccinationStatusLabel } from '../lib/vaccination'
import { useLanguage } from '../lib/i18n/LanguageContext'

function VaccinationBadge({ nextDate }: { nextDate: string | null }) {
  const { t } = useLanguage()
  const status = vaccinationStatus(nextDate)
  return <span className={`vaccination-badge vaccination-${status}`}>{vaccinationStatusLabel(t, status)}</span>
}

export default VaccinationBadge
