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
  clinic_logo_changed: 'admin.action.clinicLogoChanged',
  clinic_logo_removed: 'admin.action.clinicLogoRemoved',
  user_disabled: 'admin.action.userDisabled',
  user_enabled: 'admin.action.userEnabled',
  users_bulk_disabled: 'admin.action.usersBulkDisabled',
  users_bulk_enabled: 'admin.action.usersBulkEnabled',
  clinics_bulk_trashed: 'admin.action.clinicsBulkTrashed',
  clinics_bulk_disabled: 'admin.action.clinicsBulkDisabled',
  clinics_bulk_enabled: 'admin.action.clinicsBulkEnabled',
  staff_added: 'admin.action.staffAdded',
  staff_updated: 'admin.action.staffUpdated',
  staff_role_changed: 'admin.action.staffRoleChanged',
  staff_branches_changed: 'admin.action.staffBranchesChanged',
  staff_disabled: 'admin.action.staffDisabled',
  staff_enabled: 'admin.action.staffEnabled',
  staff_login_changed: 'admin.action.staffLoginChanged',
  branch_added: 'admin.action.branchAdded',
  branch_updated: 'admin.action.branchUpdated',
  branch_closed: 'admin.action.branchClosed',
  branch_reopened: 'admin.action.branchReopened',
  branch_made_main: 'admin.action.branchMadeMain',
  time_off_added: 'admin.action.timeOffAdded',
  time_off_updated: 'admin.action.timeOffUpdated',
  time_off_deleted: 'admin.action.timeOffDeleted',
  discount_given: 'admin.action.discountGiven',
  credit_note_issued: 'admin.action.creditNoteIssued',
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
