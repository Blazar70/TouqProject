import { supabase } from './supabase'
import type { TranslationKey } from './i18n/translations'

// Shared between AdminPage's per-clinic activity modal and AdminActivityPage
// so both render the same labels for the same underlying audit_log.action.
export const AUDIT_ACTION_LABEL_KEYS: Record<string, TranslationKey> = {
  clinic_created: 'admin.action.clinicCreated',
  clinic_updated: 'admin.action.clinicUpdated',
  clinic_trashed: 'admin.action.clinicTrashed',
  clinic_restored: 'admin.action.clinicRestored',
  clinic_purged: 'admin.action.clinicPurged',
  clinic_disabled: 'admin.action.clinicDisabled',
  clinic_enabled: 'admin.action.clinicEnabled',
  user_disabled: 'admin.action.userDisabled',
  user_enabled: 'admin.action.userEnabled',
  users_bulk_disabled: 'admin.action.usersBulkDisabled',
  users_bulk_enabled: 'admin.action.usersBulkEnabled',
  clinics_bulk_trashed: 'admin.action.clinicsBulkTrashed',
  clinics_bulk_disabled: 'admin.action.clinicsBulkDisabled',
  clinics_bulk_enabled: 'admin.action.clinicsBulkEnabled',
  staff_added: 'admin.action.staffAdded',
  password_reset: 'admin.action.passwordReset',
  profile_updated: 'admin.action.profileUpdated',
  pet_updated: 'admin.action.petUpdated',
}

export function auditActionLabelKey(action: string): TranslationKey | null {
  return AUDIT_ACTION_LABEL_KEYS[action] ?? null
}

// Client-side counterpart to the logging the admin-manage-clinic edge
// function does for create/delete — covers the admin actions that happen
// directly against the table (disable/enable, rename, billing status)
// rather than through that function. Best-effort: a logging failure
// shouldn't block or roll back the action it's describing.
export async function logAdminAction(
  actorId: string,
  actorName: string,
  action: string,
  targetType: string,
  targetLabel: string,
  clinicId: string | null = null,
) {
  await supabase
    .from('admin_audit_log')
    .insert({ actor_id: actorId, actor_name: actorName, action, target_type: targetType, target_label: targetLabel, clinic_id: clinicId })
}
