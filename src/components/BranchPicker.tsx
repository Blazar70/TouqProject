import { useEffect } from 'react'
import { Check, MapPin } from 'lucide-react'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'

// After login (must pick) or from the sidebar's "Switch branch" (can cancel).
function BranchPicker() {
  const { t } = useLanguage()
  const { pickable, branchId, asking, pick, closePicker, branchName } = useBranch()

  useEffect(() => {
    if (asking) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closePicker()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [asking, closePicker])

  return (
    <div className="admin-modal-backdrop" onClick={() => !asking && closePicker()}>
      <div
        className="admin-modal-card branch-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="branch-picker-title">{t('branch.pickTitle')}</h2>
        <p className="pet-owner">{t('branch.pickHint')}</p>
        <ul className="branch-picker-list">
          {pickable.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className={b.id === branchId ? 'is-current' : undefined}
                aria-current={b.id === branchId ? 'true' : undefined}
                onClick={() => pick(b.id)}
                autoFocus={b.id === branchId || (!branchId && b === pickable[0])}
              >
                <MapPin className="branch-picker-icon" size={20} aria-hidden />
                <span className="branch-picker-text">
                  <strong>{branchName(b.id)}</strong>
                  {b.address && <span className="pet-owner">{b.address}</span>}
                </span>
                {b.id === branchId && (
                  <span className="branch-picker-last">
                    <Check size={16} aria-hidden />
                    {t(asking ? 'branch.lastUsed' : 'branch.current')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {!asking && (
          <div className="admin-modal-actions">
            <button type="button" className="cancel-button" onClick={closePicker}>
              {t('common.cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default BranchPicker
