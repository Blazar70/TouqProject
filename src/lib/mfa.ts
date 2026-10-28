// Two-step login: admins and managers must use it; anyone else may turn it on in Settings.
// shortcut: switched off until v3 (user 10-29: it must not slow v2 testing); v3 = set true here AND MFA_ENFORCED in
// supabase/functions/_shared/aal.ts, apply supabase/v3-pending/0095 under the next free number.
export const MFA_ENABLED = false

export const mfaRequired = (profile: { role: string; clinic_role: string | null } | null) =>
  profile?.role === 'admin' || profile?.clinic_role === 'manager'

// What the user must do before the app opens: set up a code app, type a code, or nothing.
export function mfaStep(
  levels: { currentLevel: string | null; nextLevel: string | null } | null,
  required: boolean,
): 'enroll' | 'verify' | null {
  if (levels?.currentLevel === 'aal2') return null
  if (levels?.nextLevel === 'aal2') return 'verify' // has a set-up factor, signed in with the password only
  return required ? 'enroll' : null
}
