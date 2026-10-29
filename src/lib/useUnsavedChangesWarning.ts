import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import { useConfirm } from './ConfirmContext'
import { useLanguage } from './i18n/LanguageContext'
import { idleGuards } from './idleLogout'

// Warns on both ways a dirty form's edits can get silently lost: closing/
// refreshing the tab (beforeunload) and navigating to another in-app page
// or record (React Router's useBlocker, which needs the root data router
// set up in main.tsx to work at all).
export function useUnsavedChangesWarning(isDirty: boolean) {
  const { t } = useLanguage()
  const confirm = useConfirm()
  const blocker = useBlocker(isDirty)

  useEffect(() => {
    if (!isDirty) return
    idleGuards.dirtyForms++
    return () => {
      idleGuards.dirtyForms--
    }
  }, [isDirty])

  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      // Legacy but still required by some engines for the confirmation
      // dialog to actually appear — preventDefault() alone isn't universal.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let cancelled = false
    confirm(t('common.unsavedChangesConfirm'), {
      // Not danger:true — that gates the button behind a 3s countdown,
      // which fits an irreversible delete, not "discard my typing."
      confirmLabel: t('common.leaveWithoutSaving'),
      cancelLabel: t('common.stay'),
    }).then((leave) => {
      if (cancelled) return
      if (leave) blocker.proceed?.()
      else blocker.reset?.()
    })
    return () => {
      cancelled = true
    }
  }, [blocker, confirm, t])
}
