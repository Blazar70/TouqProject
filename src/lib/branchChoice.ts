// Branch filter value meaning "no branch filter".
export const ALL_BRANCHES = 'all'

type BranchLike = { id: string; active: boolean }

// Open branches a person can work at: their member branches, or every open
// branch for a manager with no rows (whole clinic, 0047). Mirrors current_user_branch_ids().
export function pickableBranches<T extends BranchLike>(branches: T[], memberIds: string[], clinicRole: string | null): T[] {
  const open = branches.filter((b) => b.active)
  if (memberIds.length === 0) return clinicRole === 'manager' ? open : []
  return open.filter((b) => memberIds.includes(b.id))
}

// The branch to start on. `confirmedId` = picked earlier in this tab (no question then);
// `remembered` = this device's last pick, then profiles.last_branch_id (pre-selected).
// ask = show the picker; branchId is then only the pre-selection (may be null).
export function startingBranch(pickable: BranchLike[], confirmedId: string | null, remembered: (string | null)[]) {
  if (pickable.length <= 1) return { branchId: pickable[0]?.id ?? null, ask: false }
  const valid = (id: string | null) => id !== null && pickable.some((b) => b.id === id)
  if (valid(confirmedId)) return { branchId: confirmedId, ask: false }
  return { branchId: remembered.find(valid) ?? null, ask: true }
}

// Does this staff member work at the branch? Doctor pickers use it.
export function worksAt(person: { clinic_role: string | null; staff_branches: { branch_id: string }[] }, branchId: string) {
  return person.staff_branches.length === 0 ? person.clinic_role === 'manager' : person.staff_branches.some((sb) => sb.branch_id === branchId)
}
