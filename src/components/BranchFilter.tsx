import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { ALL_BRANCHES } from '../lib/branchChoice'

// One open branch or "All branches". Hidden when there is a single choice.
// mine: only branches this person works at, and "All" only for whole-clinic managers (Manager page).
function BranchFilter({ value, onChange, mine = false }: { value: string; onChange: (value: string) => void; mine?: boolean }) {
  const { t } = useLanguage()
  const { branches, pickable, isClinicManager, branchName } = useBranch()
  const open = mine ? pickable : branches.filter((b) => b.active)
  const showAll = !mine || isClinicManager
  if (open.length < 2) return null
  return (
    <label className="branch-filter">
      {t('branch.filter')}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {showAll && <option value={ALL_BRANCHES}>{t('staff.allBranches')}</option>}
        {open.map((b) => (
          <option key={b.id} value={b.id}>
            {branchName(b.id)}
          </option>
        ))}
      </select>
    </label>
  )
}

export default BranchFilter
