import { RefreshCw } from 'lucide-react'
import { useLanguage } from '../lib/i18n/LanguageContext'

type RefreshButtonProps = {
  onRefresh: () => void
  refreshing: boolean
}

// A lightweight manual-refresh affordance for pages that show shared,
// frequently-changing clinic data — nothing here pushes updates, so a
// tab left open for a while can otherwise only catch up on a full reload.
function RefreshButton({ onRefresh, refreshing }: RefreshButtonProps) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      className="icon-button refresh-button"
      onClick={onRefresh}
      disabled={refreshing}
      aria-label={t('common.refresh')}
      title={t('common.refresh')}
    >
      <RefreshCw size={18} className={refreshing ? 'spinning' : undefined} />
    </button>
  )
}

export default RefreshButton
