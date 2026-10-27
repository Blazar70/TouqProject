// Who may change which staff account — the guards of clinic-manage-staff.
// Pure (no Deno or Supabase imports) so Vitest covers it: src/lib/staffRules.test.ts.

export const CLINIC_ROLES = ['manager', 'doctor', 'nurse', 'receptionist'] as const
export type ClinicRole = (typeof CLINIC_ROLES)[number]

// Same rule as the profiles.username check constraint (0047).
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/
export const MIN_PASSWORD_LENGTH = 6

// Staff have no email; auth needs one. .invalid (RFC 2606) can never deliver mail.
export function usernameToEmail(username: string) {
  return `${username}${STAFF_EMAIL_DOMAIN}`
}

const STAFF_EMAIL_DOMAIN = '@staff.touq.invalid'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A new account's login: a username, or (admin desk) a real email. Returns the
// auth email plus the username to store, or null if it is neither. Typing a
// synthetic address directly is refused so it can't squat someone's username.
export function parseStaffLogin(raw: string): { email: string; username: string | null } | null {
  const login = raw.trim().toLowerCase()
  if (login.includes('@')) {
    return EMAIL_RE.test(login) && !login.endsWith(STAFF_EMAIL_DOMAIN) ? { email: login, username: null } : null
  }
  return USERNAME_RE.test(login) ? { email: usernameToEmail(login), username: login } : null
}

// branchIds null = the whole clinic (an admin, or a manager without branch rows).
export type StaffCaller = { id: string; isAdmin: boolean; branchIds: string[] | null }
export type StaffTarget = { id: string; clinicRole: ClinicRole; disabled: boolean; branchIds: string[] }
export type StaffChange = {
  action: 'create_staff' | 'update_staff' | 'set_role' | 'set_branches' | 'set_disabled' | 'reset_password' | 'set_login'
  clinicRole?: ClinicRole
  branchIds?: string[]
  disabled?: boolean
}

// Returns why the caller may not do this, or null when allowed.
// enabledManagers = enabled managers in the clinic right now.
export function staffChangeError(caller: StaffCaller, target: StaffTarget | null, change: StaffChange, enabledManagers: number): string | null {
  const self = target?.id === caller.id
  const role = change.clinicRole ?? target?.clinicRole

  if (!caller.isAdmin) {
    if (change.action === 'set_login') return 'Only an admin can change a login'
    if (change.clinicRole === 'manager' || (target?.clinicRole === 'manager' && !self)) {
      return 'Only an admin can create or change managers'
    }
    if (self && ['set_role', 'set_branches', 'set_disabled'].includes(change.action)) {
      return "You can't change your own role, branches or access"
    }
    // A branch manager only reaches staff and branches inside their own branches.
    if (caller.branchIds && target && !self) {
      const inScope = (id: string) => caller.branchIds!.includes(id)
      // Name/phone edits need one shared branch; anything touching the login, role or access needs all of them.
      const reach = change.action === 'update_staff' ? target.branchIds.some(inScope) : target.branchIds.every(inScope)
      if (!reach) return 'This staff member is outside your branches'
    }
    if (caller.branchIds && change.branchIds?.some((id) => !caller.branchIds!.includes(id))) {
      return 'You can only assign your own branches'
    }
  }

  if (role !== 'manager' && change.branchIds && change.branchIds.length === 0) {
    return 'Staff below manager need at least one branch'
  }

  const losesManager =
    target?.clinicRole === 'manager' &&
    !target.disabled &&
    ((change.action === 'set_role' && change.clinicRole !== 'manager') || (change.action === 'set_disabled' && change.disabled))
  if (losesManager && enabledManagers <= 1) return 'A clinic must keep at least one active manager'

  return null
}
