import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { ALL_BRANCHES } from '../lib/branchChoice'

// One open branch or "All branches". Hidden when the clinic has a single open branch.
function BranchFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  const { branches, branchName } = useBranch()
  const open = branches.filter((b) => b.active)
  if (open.length < 2) return null
  return (
    <label className="branch-filter">
      {t('branch.filter')}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL_BRANCHES}>{t('staff.allBranches')}</option>
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
