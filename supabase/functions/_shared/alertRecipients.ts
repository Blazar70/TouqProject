// Who gets an appointment's push alert (phase 5, user 2026-10-23). Pure, so the app's
// tests can import it (src/lib/alertRecipients.test.ts).
// Doctors: only their own appointments. Everyone else: appointments at a branch they
// work at; a manager with no branch rows runs the whole clinic and gets all.
// Unassigned appointments therefore reach the non-doctors of that branch only.
export type AlertProfile = { id: string; clinic_role: string | null; branchIds: string[] }
export type AlertAppointment = { doctor_id: string | null; branch_id: string }

export function getsAlert(profile: AlertProfile, appointment: AlertAppointment): boolean {
  if (profile.clinic_role === 'doctor') return appointment.doctor_id === profile.id
  if (profile.clinic_role === 'manager' && profile.branchIds.length === 0) return true
  return profile.branchIds.includes(appointment.branch_id)
}

// Inpatient dose reminders (0082, user 2026-10-24): the doctors and nurses who work at the branch
// the pet is at now. Managers and reception don't get them.
export function getsInpatientAlert(profile: AlertProfile, stayBranchId: string): boolean {
  return (profile.clinic_role === 'doctor' || profile.clinic_role === 'nurse') && profile.branchIds.includes(stayBranchId)
}
