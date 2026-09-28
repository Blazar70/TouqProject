import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Database } from './database.types'

type Profile = Database['public']['Tables']['profiles']['Row']

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  clinicName: string | null
  clinicPhone: string | null
  clinicDisabled: boolean
  refreshClinicName: () => void
  loading: boolean
  passwordRecovery: boolean
  clearPasswordRecovery: () => void
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  clinicName: null,
  clinicPhone: null,
  clinicDisabled: false,
  refreshClinicName: () => {},
  loading: true,
  passwordRecovery: false,
  clearPasswordRecovery: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [clinicName, setClinicName] = useState<string | null>(null)
  const [clinicPhone, setClinicPhone] = useState<string | null>(null)
  const [clinicDisabled, setClinicDisabled] = useState(false)
  const [profileLoaded, setProfileLoaded] = useState(false)
  // Set when the user arrives via a "reset your password" email link —
  // Supabase signs them into a temporary session and fires this specific
  // event so the app can show a "set new password" screen instead of
  // dropping them straight into the app under whatever the recovered
  // session's normal role/routing would otherwise be.
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const loadProfile = useCallback(async () => {
    if (!session) {
      setProfile(null)
      setClinicName(null)
      setClinicPhone(null)
      setClinicDisabled(false)
      setProfileLoaded(true)
      return
    }
    // Fetch the profile and its clinic's name in one request — avoids a
    // second sequential round-trip (and the flash that comes with it)
    // between "profile loaded" and "clinic name loaded". clinics(disabled)
    // stays readable even for a disabled clinic (see
    // clinics_select_own_vet_regardless_disabled) specifically so this can
    // detect that state and the app can show a clear message instead of
    // just silently showing empty data everywhere.
    const { data } = await supabase
      .from('profiles')
      .select('*, clinics(name, phone, disabled)')
      .eq('id', session.user.id)
      .maybeSingle()

    if (data) {
      const { clinics, ...profileRow } = data
      setProfile(profileRow as Profile)
      setClinicName(clinics?.name ?? null)
      setClinicPhone(clinics?.phone ?? null)
      setClinicDisabled(clinics?.disabled ?? false)
    } else {
      setProfile(null)
      setClinicName(null)
      setClinicPhone(null)
      setClinicDisabled(false)
    }
    setProfileLoaded(true)
  }, [session])

  // Supabase silently refreshes the auth token whenever the tab regains
  // focus (e.g. alt-tabbing back), firing onAuthStateChange with a *new*
  // session object for the same user. Keying this off the session object
  // itself (rather than the user id) would re-trigger setProfileLoaded(false)
  // on every one of those refreshes — dropping back to the full-page loading
  // screen on every alt-tab, even though nothing about the profile changed.
  const userId = session?.user.id ?? null
  useEffect(() => {
    if (!sessionLoaded) return
    setProfileLoaded(false)
    loadProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoaded, userId])

  const refreshClinicName = useCallback(() => {
    loadProfile()
  }, [loadProfile])

  const loading = !sessionLoaded || !profileLoaded
  const clearPasswordRecovery = useCallback(() => setPasswordRecovery(false), [])

  return (
    <AuthContext.Provider
      value={{ session, profile, clinicName, clinicPhone, clinicDisabled, refreshClinicName, loading, passwordRecovery, clearPasswordRecovery }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
