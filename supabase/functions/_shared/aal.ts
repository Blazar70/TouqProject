// Sign-in level from the caller's JWT; read it only after auth.getUser() has verified the token.
// 'aal2' = signed in with a two-step code. Admins and managers must have it once two-step is on.
// shortcut: off until v3 (user 10-29), together with MFA_ENABLED in src/lib/mfa.ts.
export const MFA_ENFORCED = false

export function jwtAal(authHeader: string): string {
  try {
    const payload = authHeader.replace(/^Bearer /, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).aal ?? 'aal1'
  } catch {
    return 'aal1'
  }
}
