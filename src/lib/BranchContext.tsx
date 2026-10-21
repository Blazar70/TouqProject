import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { useLanguage } from './i18n/LanguageContext'
import { pickableBranches, startingBranch } from './branchChoice'
import type { Database } from './database.types'

export type Branch = Database['public']['Tables']['branches']['Row']

type BranchContextValue = {
  /** Every branch of the clinic, closed ones included (for names on old rows). */
  branches: Branch[]
  /** Open branches this person can work at. */
  pickable: Branch[]
  /** The branch picked for this device/tab; null for admins or before picking. */
  branchId: string | null
  /** Manager with no branch rows: runs the whole clinic. */
  isClinicManager: boolean
  loading: boolean
  /** Must pick before using the app (2+ branches, nothing valid picked in this tab). */
  asking: boolean
  pick: (branchId: string) => void
  branchName: (branchId: string | null) => string
  reload: () => void
}

const BranchContext = createContext<BranchContextValue | null>(null)

// sessionStorage: picked in this tab (no question on reload). localStorage: this device's last pick.
function readKey(storage: () => Storage, key: string) {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function writeKey(storage: () => Storage, key: string, value: string) {
  try {
    storage().setItem(key, value)
  } catch {
    // Private mode / blocked storage: the pick still holds for this page load.
  }
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { language } = useLanguage()
  const [branches, setBranches] = useState<Branch[]>([])
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [branchId, setBranchId] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  const profileId = profile?.id ?? null
  const clinicId = profile?.role === 'vet' ? profile.clinic_id : null
  const clinicRole = profile?.clinic_role ?? null
  const lastBranchId = profile?.last_branch_id ?? null
  const storageKey = `touq.branch.${profileId}`
  // Loading until this exact login is loaded, so pages never run a query with the previous user's branch.
  const loadKey = `${profileId}:${clinicId}`

  const load = useCallback(async () => {
    if (!profileId || !clinicId) {
      setBranches([])
      setMemberIds([])
      setBranchId(null)
      setAsking(false)
      setLoadedKey(`${profileId}:${clinicId}`)
      return
    }
    const [branchesRes, membersRes] = await Promise.all([
      supabase.from('branches').select('*').eq('clinic_id', clinicId).order('is_main', { ascending: false }).order('name'),
      supabase.from('staff_branches').select('branch_id').eq('profile_id', profileId),
    ])
    const all = branchesRes.data ?? []
    const members = (membersRes.data ?? []).map((r) => r.branch_id)
    const start = startingBranch(
      pickableBranches(all, members, clinicRole),
      readKey(() => sessionStorage, storageKey),
      [readKey(() => localStorage, storageKey), lastBranchId],
    )
    setBranches(all)
    setMemberIds(members)
    setBranchId(start.branchId)
    setAsking(start.ask)
    setLoadedKey(`${profileId}:${clinicId}`)
    // lastBranchId is read once per login; re-reading it after pick() would only repeat the pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, clinicId, clinicRole, storageKey])

  useEffect(() => {
    load()
  }, [load])

  const pick = useCallback(
    (id: string) => {
      setBranchId(id)
      setAsking(false)
      writeKey(() => sessionStorage, storageKey, id)
      writeKey(() => localStorage, storageKey, id)
      if (profileId) supabase.from('profiles').update({ last_branch_id: id }).eq('id', profileId).then()
    },
    [profileId, storageKey],
  )

  const branchName = useCallback(
    (id: string | null) => {
      const b = branches.find((x) => x.id === id)
      return b ? (language === 'ar' && b.name_ar) || b.name : ''
    },
    [branches, language],
  )

  const value: BranchContextValue = {
    branches,
    pickable: pickableBranches(branches, memberIds, clinicRole),
    branchId,
    isClinicManager: clinicRole === 'manager' && memberIds.length === 0,
    loading: loadedKey !== loadKey,
    asking,
    pick,
    branchName,
    reload: load,
  }

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

export function useBranch() {
  const value = useContext(BranchContext)
  if (!value) throw new Error('useBranch must be used inside BranchProvider')
  return value
}
