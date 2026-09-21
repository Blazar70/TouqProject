import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ChevronDown, Download, Search, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { speciesLabel, POPULAR_SPECIES } from '../lib/species'
import { isValidSaudiMobile, stripSaudiPrefix } from '../lib/phone'
import { downloadCsv } from '../lib/csvExport'
import { logAdminAction, auditActionLabelKey } from '../lib/adminAudit'
import PhoneInput from '../components/PhoneInput'
import RequiredMark from '../components/RequiredMark'
import LoadingScreen from '../components/LoadingScreen'
import SimpleBarChart from '../components/SimpleBarChart'
import Ltr from '../components/Ltr'

type Clinic = Database['public']['Tables']['clinics']['Row']
type Profile = Database['public']['Tables']['profiles']['Row']
type Pet = Database['public']['Tables']['pets']['Row']
type AuditLogEntry = Database['public']['Tables']['admin_audit_log']['Row']
type AppointmentStub = { clinic_id: string; created_at: string }
type PetStub = { id: string; name: string; owner_name: string; clinic_id: string }
type GlobalSearchResult = { type: 'clinic' | 'user' | 'pet'; id: string; label: string; detail: string }

const BILLING_STATUSES = ['active', 'trial', 'overdue', 'cancelled'] as const

const DORMANT_WINDOW_DAYS = 30
const CHART_WEEKS = 8
const TRASH_RETENTION_DAYS = 7
const ABUSE_SIGNAL_PETS_24H = 15
const ABUSE_SIGNAL_APPOINTMENTS_24H = 30

function AdminPage() {
  const { profile: currentProfile } = useAuth()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()

  const [clinics, setClinics] = useState<Clinic[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [petCounts, setPetCounts] = useState<Record<string, number>>({})
  const [appointmentCounts, setAppointmentCounts] = useState<Record<string, number>>({})
  const [staffCounts, setStaffCounts] = useState<Record<string, number>>({})
  const [appointmentsRaw, setAppointmentsRaw] = useState<AppointmentStub[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [clinicSearch, setClinicSearch] = useState('')
  const [expandedClinicId, setExpandedClinicId] = useState<string | null>(null)
  const [deletingClinicId, setDeletingClinicId] = useState<string | null>(null)
  const [restoringClinicId, setRestoringClinicId] = useState<string | null>(null)
  const [togglingClinicId, setTogglingClinicId] = useState<string | null>(null)

  const [showNewClinicForm, setShowNewClinicForm] = useState(false)
  const [newClinicName, setNewClinicName] = useState('')
  const [newVetFullName, setNewVetFullName] = useState('')
  const [newVetEmail, setNewVetEmail] = useState('')
  const [newVetPassword, setNewVetPassword] = useState('')
  const [newVetPhone, setNewVetPhone] = useState('')
  const [creatingClinic, setCreatingClinic] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [editingClinicId, setEditingClinicId] = useState<string | null>(null)
  const [editClinicName, setEditClinicName] = useState('')
  const [editClinicBillingStatus, setEditClinicBillingStatus] = useState<string>('active')
  const [savingClinicEdit, setSavingClinicEdit] = useState(false)

  const [selectedClinicIds, setSelectedClinicIds] = useState<Set<string>>(new Set())
  const [bulkClinicsBusy, setBulkClinicsBusy] = useState(false)

  const [globalQuery, setGlobalQuery] = useState('')
  const [globalResults, setGlobalResults] = useState<GlobalSearchResult[] | null>(null)
  const [jumpHighlightId, setJumpHighlightId] = useState<string | null>(null)
  const [petModalOpen, setPetModalOpen] = useState(false)
  const [petModalLoading, setPetModalLoading] = useState(false)
  const [petModalData, setPetModalData] = useState<Pet | null>(null)

  const [addStaffClinicId, setAddStaffClinicId] = useState<string | null>(null)
  const [addStaffFullName, setAddStaffFullName] = useState('')
  const [addStaffEmail, setAddStaffEmail] = useState('')
  const [addStaffPassword, setAddStaffPassword] = useState('')
  const [addStaffPhone, setAddStaffPhone] = useState('')
  const [addingStaff, setAddingStaff] = useState(false)
  const [addStaffError, setAddStaffError] = useState<string | null>(null)

  const [userModalId, setUserModalId] = useState<string | null>(null)
  const [userModalLoading, setUserModalLoading] = useState(false)
  const [userModalStats, setUserModalStats] = useState<{
    appointmentsCreated: number
    recordsAuthored: number
    pushSubscriptions: number
  } | null>(null)
  const [showResetPassword, setShowResetPassword] = useState(false)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)

  const [editingUserFields, setEditingUserFields] = useState(false)
  const [editUserFullName, setEditUserFullName] = useState('')
  const [editUserPhone, setEditUserPhone] = useState('')
  const [editUserRole, setEditUserRole] = useState('vet')
  const [editUserClinicId, setEditUserClinicId] = useState('')
  const [savingUserEdit, setSavingUserEdit] = useState(false)
  const [userEditError, setUserEditError] = useState<string | null>(null)

  const [editingPetFields, setEditingPetFields] = useState(false)
  const [editPetName, setEditPetName] = useState('')
  const [editPetSpecies, setEditPetSpecies] = useState('')
  const [editPetBreed, setEditPetBreed] = useState('')
  const [editPetDob, setEditPetDob] = useState('')
  const [editPetOwnerName, setEditPetOwnerName] = useState('')
  const [editPetOwnerPhone, setEditPetOwnerPhone] = useState('')
  const [editPetOwnerEmail, setEditPetOwnerEmail] = useState('')
  const [savingPetEdit, setSavingPetEdit] = useState(false)
  const [petEditError, setPetEditError] = useState<string | null>(null)

  const [petsRaw, setPetsRaw] = useState<{ clinic_id: string; created_at: string }[]>([])
  const [activityModalClinicId, setActivityModalClinicId] = useState<string | null>(null)
  const [clinicActivity, setClinicActivity] = useState<AuditLogEntry[]>([])
  const [loadingClinicActivity, setLoadingClinicActivity] = useState(false)
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null)

  const [trashModalOpen, setTrashModalOpen] = useState(false)

  async function load() {
    const [clinicsRes, profilesRes, petsRes, appointmentsRes, caregiversRes] = await Promise.all([
      supabase.from('clinics').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('pets').select('clinic_id, created_at').is('deleted_at', null),
      supabase.from('appointments').select('clinic_id, created_at'),
      supabase.from('caregivers').select('clinic_id').is('deleted_at', null),
    ])
    setClinics(clinicsRes.data ?? [])
    setProfiles(profilesRes.data ?? [])
    setPetCounts(countBy(petsRes.data ?? []))
    setAppointmentCounts(countBy(appointmentsRes.data ?? []))
    setStaffCounts(countBy(caregiversRes.data ?? []))
    setAppointmentsRaw(appointmentsRes.data ?? [])
    setPetsRaw(petsRes.data ?? [])
    setLoading(false)
  }

  function countBy(rows: { clinic_id: string }[]) {
    const counts: Record<string, number> = {}
    for (const row of rows) counts[row.clinic_id] = (counts[row.clinic_id] ?? 0) + 1
    return counts
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced cross-tenant search — clinics, users, and pets in one box, so
  // support work ("a user says an appointment disappeared") doesn't require
  // drilling into each clinic one at a time to find the right one.
  useEffect(() => {
    const q = globalQuery.trim()
    if (q.length < 2) {
      setGlobalResults(null)
      return
    }
    const timer = setTimeout(async () => {
      // Numeric-looking queries also match against phone (stored as
      // +966XXXXXXXXX) so support staff can paste a caller's number
      // straight in without stripping the country code themselves.
      const qDigits = q.replace(/\D/g, '')
      const profileFilter =
        qDigits.length >= 3 ? `full_name.ilike.%${q}%,phone.ilike.%${qDigits}%` : `full_name.ilike.%${q}%`
      const [clinicsRes, profilesRes, petsRes] = await Promise.all([
        supabase.from('clinics').select('id, name').ilike('name', `%${q}%`).limit(10),
        supabase.from('profiles').select('id, full_name, role, clinic_id').or(profileFilter).limit(10),
        supabase.from('pets').select('id, name, owner_name, clinic_id').or(`name.ilike.%${q}%,owner_name.ilike.%${q}%`).limit(10),
      ])
      const clinicNames = Object.fromEntries((clinicsRes.data ?? []).map((c) => [c.id, c.name]))
      const results: GlobalSearchResult[] = [
        ...(clinicsRes.data ?? []).map((c) => ({ type: 'clinic' as const, id: c.id, label: c.name, detail: t('admin.clinics') })),
        ...(profilesRes.data ?? []).map((p) => ({
          type: 'user' as const,
          id: p.id,
          label: p.full_name,
          detail: `${t(`role.${p.role}` as TranslationKey)}${p.clinic_id ? ` · ${clinicNames[p.clinic_id] ?? ''}` : ''}`,
        })),
        ...((petsRes.data ?? []) as PetStub[]).map((pet) => ({
          type: 'pet' as const,
          id: pet.id,
          label: pet.name,
          detail: `${pet.owner_name} · ${clinicNames[pet.clinic_id] ?? ''}`,
        })),
      ]
      setGlobalResults(results)
    }, 300)
    return () => clearTimeout(timer)
  }, [globalQuery, t])

  const clinicNameById = useMemo(() => Object.fromEntries(clinics.map((c) => [c.id, c.name])), [clinics])

  const trashedClinics = useMemo(() => clinics.filter((c) => c.deleted_at), [clinics])

  const filteredClinics = useMemo(() => {
    const q = clinicSearch.trim().toLowerCase()
    const active = clinics.filter((c) => !c.deleted_at)
    if (!q) return active
    return active.filter((c) => c.name.toLowerCase().includes(q))
  }, [clinics, clinicSearch])

  const disabledCount = profiles.filter((p) => p.disabled).length

  const { activeClinicCount, dormantClinicCount } = useMemo(() => {
    const cutoff = Date.now() - DORMANT_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const activeClinicIds = new Set(
      appointmentsRaw.filter((a) => new Date(a.created_at).getTime() >= cutoff).map((a) => a.clinic_id),
    )
    const liveClinicCount = clinics.filter((c) => !c.deleted_at).length
    return {
      activeClinicCount: activeClinicIds.size,
      dormantClinicCount: Math.max(0, liveClinicCount - activeClinicIds.size),
    }
  }, [appointmentsRaw, clinics])

  const weeklyChartData = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const weeks: { label: string; value: number; start: number; end: number }[] = []
    for (let i = CHART_WEEKS - 1; i >= 0; i--) {
      const end = new Date(now)
      end.setDate(end.getDate() - i * 7)
      const start = new Date(end)
      start.setDate(start.getDate() - 7)
      weeks.push({
        label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        value: 0,
        start: start.getTime(),
        end: end.getTime(),
      })
    }
    for (const a of appointmentsRaw) {
      const t = new Date(a.created_at).getTime()
      const bucket = weeks.find((w) => t >= w.start && t < w.end)
      if (bucket) bucket.value += 1
    }
    return weeks.map(({ label, value }) => ({ label, value }))
  }, [appointmentsRaw])

  // A lightweight abuse signal, not real rate limiting (that belongs at the
  // infrastructure layer, not in-app) — flags a clinic whose pet/appointment
  // creation volume in the last 24h is well outside what a normal small
  // clinic would generate, worth a human glance rather than a hard block.
  const recentActivityByClinic = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const result: Record<string, { pets24h: number; appointments24h: number }> = {}
    for (const p of petsRaw) {
      if (new Date(p.created_at).getTime() < cutoff) continue
      result[p.clinic_id] ??= { pets24h: 0, appointments24h: 0 }
      result[p.clinic_id].pets24h += 1
    }
    for (const a of appointmentsRaw) {
      if (new Date(a.created_at).getTime() < cutoff) continue
      result[a.clinic_id] ??= { pets24h: 0, appointments24h: 0 }
      result[a.clinic_id].appointments24h += 1
    }
    return result
  }, [petsRaw, appointmentsRaw])

  async function handleToggleDisabled(p: Profile) {
    if (p.id === currentProfile?.id) return

    if (!p.disabled) {
      const ok = await confirm(t('admin.disableConfirm', { name: p.full_name }), {
        danger: true,
        confirmLabel: t('admin.disable'),
      })
      if (!ok) return
    }

    setTogglingId(p.id)
    const { data, error } = await supabase
      .from('profiles')
      .update({ disabled: !p.disabled })
      .eq('id', p.id)
      .select()
      .single()

    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      setTogglingId(null)
      return
    }

    setProfiles((current) => current.map((row) => (row.id === data.id ? data : row)))
    if (currentProfile) {
      await logAdminAction(
        currentProfile.id,
        currentProfile.full_name,
        data.disabled ? 'user_disabled' : 'user_enabled',
        'profile',
        data.full_name,
        data.clinic_id,
      )
    }
    toast.success(data.disabled ? t('admin.disabled', { name: data.full_name }) : t('admin.enabled', { name: data.full_name }))
    setTogglingId(null)
    load()
  }

  async function handleCreateClinic(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)

    if (!newClinicName.trim() || !newVetFullName.trim() || !newVetEmail.trim() || newVetPassword.length < 6) {
      setCreateError(t('admin.newClinicInvalid'))
      return
    }

    setCreatingClinic(true)
    const { data, error } = await supabase.functions.invoke('admin-manage-clinic', {
      body: {
        action: 'create',
        clinicName: newClinicName.trim(),
        vetFullName: newVetFullName.trim(),
        vetEmail: newVetEmail.trim(),
        vetPassword: newVetPassword,
        vetPhone: newVetPhone ? `+966${newVetPhone}` : null,
      },
    })

    if (error || data?.error) {
      setCreateError(data?.error ?? error?.message ?? t('common.couldNotSave'))
      setCreatingClinic(false)
      return
    }

    toast.success(t('admin.clinicCreated', { name: newClinicName.trim() }))
    setNewClinicName('')
    setNewVetFullName('')
    setNewVetEmail('')
    setNewVetPassword('')
    setNewVetPhone('')
    setShowNewClinicForm(false)
    setCreatingClinic(false)
    await load()
  }

  async function handleTrashClinic(clinic: Clinic) {
    const ok = await confirm(t('admin.trashClinicConfirm', { name: clinic.name, days: String(TRASH_RETENTION_DAYS) }), {
      danger: true,
      confirmLabel: t('admin.moveToTrash'),
    })
    if (!ok) return

    setDeletingClinicId(clinic.id)
    const { data, error } = await supabase.functions.invoke('admin-manage-clinic', {
      body: { action: 'trash', clinicId: clinic.id },
    })

    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? t('common.couldNotSave'))
      setDeletingClinicId(null)
      return
    }

    toast.success(t('admin.clinicTrashed', { name: clinic.name }))
    setExpandedClinicId((current) => (current === clinic.id ? null : current))
    setDeletingClinicId(null)
    await load()
  }

  async function handleRestoreClinic(clinic: Clinic) {
    setRestoringClinicId(clinic.id)
    const { data, error } = await supabase.functions.invoke('admin-manage-clinic', {
      body: { action: 'restore', clinicId: clinic.id },
    })

    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? t('common.couldNotSave'))
      setRestoringClinicId(null)
      return
    }

    toast.success(t('admin.clinicRestored', { name: clinic.name }))
    setRestoringClinicId(null)
    await load()
  }

  async function handlePurgeClinic(clinic: Clinic) {
    const ok = await confirm(t('admin.purgeClinicConfirm', { name: clinic.name }), {
      danger: true,
      confirmLabel: t('admin.purgeNow'),
    })
    if (!ok) return

    setDeletingClinicId(clinic.id)
    const { data, error } = await supabase.functions.invoke('admin-manage-clinic', {
      body: { action: 'purge', clinicId: clinic.id },
    })

    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? t('common.couldNotSave'))
      setDeletingClinicId(null)
      return
    }

    toast.success(t('admin.clinicPurged', { name: clinic.name }))
    setDeletingClinicId(null)
    await load()
  }

  async function handleToggleClinicDisabled(clinic: Clinic) {
    if (!clinic.disabled) {
      const ok = await confirm(t('admin.disableClinicConfirm', { name: clinic.name }), {
        danger: true,
        confirmLabel: t('admin.disable'),
      })
      if (!ok) return
    }

    setTogglingClinicId(clinic.id)
    const { data, error } = await supabase
      .from('clinics')
      .update({ disabled: !clinic.disabled })
      .eq('id', clinic.id)
      .select()
      .single()

    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      setTogglingClinicId(null)
      return
    }

    setClinics((current) => current.map((c) => (c.id === data.id ? data : c)))
    if (currentProfile) {
      await logAdminAction(
        currentProfile.id,
        currentProfile.full_name,
        data.disabled ? 'clinic_disabled' : 'clinic_enabled',
        'clinic',
        data.name,
        data.id,
      )
    }
    toast.success(data.disabled ? t('admin.clinicDisabled', { name: data.name }) : t('admin.clinicEnabled', { name: data.name }))
    setTogglingClinicId(null)
  }

  function startEditClinic(clinic: Clinic) {
    setEditingClinicId(clinic.id)
    setEditClinicName(clinic.name)
    setEditClinicBillingStatus(clinic.billing_status)
  }

  async function handleSaveClinicEdit(e: FormEvent, clinic: Clinic) {
    e.preventDefault()
    if (!editClinicName.trim()) return

    setSavingClinicEdit(true)
    const { data, error } = await supabase
      .from('clinics')
      .update({ name: editClinicName.trim(), billing_status: editClinicBillingStatus })
      .eq('id', clinic.id)
      .select()
      .single()

    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      setSavingClinicEdit(false)
      return
    }

    setClinics((current) => current.map((c) => (c.id === data.id ? data : c)))
    if (currentProfile) {
      await logAdminAction(currentProfile.id, currentProfile.full_name, 'clinic_updated', 'clinic', data.name, data.id)
    }
    toast.success(t('admin.clinicUpdated', { name: data.name }))
    setEditingClinicId(null)
    setSavingClinicEdit(false)
  }

  async function openClinicActivity(clinicId: string) {
    setActivityModalClinicId(clinicId)
    setLoadingClinicActivity(true)
    const { data } = await supabase
      .from('admin_audit_log')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(50)
    setClinicActivity(data ?? [])
    setLoadingClinicActivity(false)
  }

  function startAddStaff(clinicId: string) {
    setAddStaffClinicId(clinicId)
    setAddStaffFullName('')
    setAddStaffEmail('')
    setAddStaffPassword('')
    setAddStaffPhone('')
    setAddStaffError(null)
  }

  async function handleAddStaff(e: FormEvent, clinicId: string) {
    e.preventDefault()
    setAddStaffError(null)

    if (!addStaffFullName.trim() || !addStaffEmail.trim() || addStaffPassword.length < 6) {
      setAddStaffError(t('admin.addUserInvalid'))
      return
    }

    setAddingStaff(true)
    const { data, error } = await supabase.functions.invoke('admin-manage-clinic', {
      body: {
        action: 'add_staff',
        clinicId,
        fullName: addStaffFullName.trim(),
        email: addStaffEmail.trim(),
        password: addStaffPassword,
        phone: addStaffPhone ? `+966${addStaffPhone}` : null,
      },
    })

    if (error || data?.error) {
      setAddStaffError(data?.error ?? error?.message ?? t('common.couldNotSave'))
      setAddingStaff(false)
      return
    }

    toast.success(t('admin.userAdded', { name: addStaffFullName.trim() }))
    setAddStaffClinicId(null)
    setAddingStaff(false)
    await load()
  }

  async function openUserModal(userId: string) {
    setUserModalId(userId)
    setUserModalLoading(true)
    setEditingUserFields(false)
    const [appointmentsRes, recordsRes, pushRes] = await Promise.all([
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('created_by', userId),
      supabase.from('medical_records').select('id', { count: 'exact', head: true }).eq('vet_id', userId),
      supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('profile_id', userId),
    ])
    setUserModalStats({
      appointmentsCreated: appointmentsRes.count ?? 0,
      recordsAuthored: recordsRes.count ?? 0,
      pushSubscriptions: pushRes.count ?? 0,
    })
    setUserModalLoading(false)
  }

  function startEditUserFields(p: Profile) {
    setEditUserFullName(p.full_name)
    setEditUserPhone(stripSaudiPrefix(p.phone))
    setEditUserRole(p.role)
    setEditUserClinicId(p.clinic_id ?? '')
    setUserEditError(null)
    setEditingUserFields(true)
  }

  async function handleSaveUserEdit(e: FormEvent, p: Profile) {
    e.preventDefault()
    setUserEditError(null)

    if (!editUserFullName.trim()) {
      setUserEditError(t('admin.userEditInvalid'))
      return
    }
    if (editUserPhone && !isValidSaudiMobile(editUserPhone)) {
      setUserEditError(t('registerPet.invalidPhone'))
      return
    }
    if (editUserRole === 'vet' && !editUserClinicId) {
      setUserEditError(t('admin.vetNeedsClinic'))
      return
    }

    setSavingUserEdit(true)
    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name: editUserFullName.trim(),
        phone: editUserPhone ? `+966${editUserPhone}` : null,
        role: editUserRole as 'vet' | 'owner' | 'admin',
        clinic_id: editUserRole === 'vet' ? editUserClinicId : null,
      })
      .eq('id', p.id)
      .select()
      .single()

    if (error || !data) {
      setUserEditError(error?.message ?? t('common.couldNotSave'))
      setSavingUserEdit(false)
      return
    }

    setProfiles((current) => current.map((row) => (row.id === data.id ? data : row)))
    if (currentProfile) {
      await logAdminAction(currentProfile.id, currentProfile.full_name, 'profile_updated', 'profile', data.full_name, data.clinic_id)
    }
    toast.success(t('admin.userUpdated', { name: data.full_name }))
    setEditingUserFields(false)
    setSavingUserEdit(false)
  }

  function closeUserModal() {
    setUserModalId(null)
    setUserModalStats(null)
    setShowResetPassword(false)
    setResetPasswordValue('')
    setResetPasswordError(null)
    setEditingUserFields(false)
  }

  async function handleResetPassword(e: FormEvent, userId: string) {
    e.preventDefault()
    setResetPasswordError(null)

    if (resetPasswordValue.length < 6) {
      setResetPasswordError(t('admin.resetPasswordInvalid'))
      return
    }

    setResettingPassword(true)
    const { data, error } = await supabase.functions.invoke('admin-manage-clinic', {
      body: { action: 'reset_password', userId, newPassword: resetPasswordValue },
    })

    if (error || data?.error) {
      setResetPasswordError(data?.error ?? error?.message ?? t('common.couldNotSave'))
      setResettingPassword(false)
      return
    }

    toast.success(t('admin.passwordReset'))
    setShowResetPassword(false)
    setResetPasswordValue('')
    setResettingPassword(false)
  }

  function toggleClinicSelected(id: string) {
    setSelectedClinicIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllClinics() {
    setSelectedClinicIds((current) =>
      current.size === filteredClinics.length ? new Set() : new Set(filteredClinics.map((c) => c.id)),
    )
  }

  async function handleBulkDisableClinics(disabled: boolean) {
    const count = selectedClinicIds.size
    if (disabled) {
      const ok = await confirm(t('admin.bulkDisableClinicsConfirm', { count: String(count) }), {
        danger: true,
        confirmLabel: t('admin.disable'),
      })
      if (!ok) return
    }

    setBulkClinicsBusy(true)
    const ids = Array.from(selectedClinicIds)
    const { error } = await supabase.from('clinics').update({ disabled }).in('id', ids)
    if (error) {
      toast.error(error.message)
      setBulkClinicsBusy(false)
      return
    }
    if (currentProfile) {
      await logAdminAction(
        currentProfile.id,
        currentProfile.full_name,
        disabled ? 'clinics_bulk_disabled' : 'clinics_bulk_enabled',
        'clinic',
        String(count),
      )
    }
    toast.success(
      disabled
        ? t('admin.bulkDisableClinicsDone', { count: String(count) })
        : t('admin.bulkEnableClinicsDone', { count: String(count) }),
    )
    setSelectedClinicIds(new Set())
    setBulkClinicsBusy(false)
    await load()
  }

  async function handleBulkTrashClinics() {
    const count = selectedClinicIds.size
    const ok = await confirm(t('admin.bulkTrashClinicsConfirm', { count: String(count), days: String(TRASH_RETENTION_DAYS) }), {
      danger: true,
      confirmLabel: t('admin.moveToTrash'),
    })
    if (!ok) return

    setBulkClinicsBusy(true)
    const ids = Array.from(selectedClinicIds)
    for (const id of ids) {
      await supabase.functions.invoke('admin-manage-clinic', { body: { action: 'trash', clinicId: id } })
    }
    if (currentProfile) {
      await logAdminAction(currentProfile.id, currentProfile.full_name, 'clinics_bulk_trashed', 'clinic', String(count))
    }
    toast.success(t('admin.bulkTrashClinicsDone', { count: String(count) }))
    setSelectedClinicIds(new Set())
    setBulkClinicsBusy(false)
    await load()
  }

  function handleExportClinicsCsv() {
    downloadCsv(
      'clinics.csv',
      ['Name', 'Billing status', 'Vets', 'Staff', 'Pets', 'Appointments', 'Created'],
      filteredClinics.map((c) => [
        c.name,
        c.billing_status,
        profiles.filter((p) => p.clinic_id === c.id).length,
        staffCounts[c.id] ?? 0,
        petCounts[c.id] ?? 0,
        appointmentCounts[c.id] ?? 0,
        new Date(c.created_at).toLocaleDateString(),
      ]),
    )
  }

  function auditActionLabel(action: string) {
    const key = auditActionLabelKey(action)
    return key ? t(key) : action
  }

  function roleLabel(role: string) {
    return t(`role.${role}` as TranslationKey)
  }

  function billingStatusLabel(status: string) {
    return t(`billingStatus.${status}` as TranslationKey)
  }

  function flashAndScrollTo(elementId: string, highlightId: string) {
    setJumpHighlightId(highlightId)
    requestAnimationFrame(() => {
      document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    setTimeout(() => setJumpHighlightId((current) => (current === highlightId ? null : current)), 2000)
  }

  function closeGlobalSearch() {
    setGlobalQuery('')
    setGlobalResults(null)
  }

  function handleSearchResultClick(result: GlobalSearchResult) {
    closeGlobalSearch()
    if (result.type === 'clinic') {
      setClinicSearch('')
      setExpandedClinicId(result.id)
      flashAndScrollTo(`admin-clinic-${result.id}`, result.id)
    } else if (result.type === 'user') {
      openUserModal(result.id)
    } else {
      openPetModal(result.id)
    }
  }

  async function openPetModal(petId: string) {
    setPetModalOpen(true)
    setPetModalLoading(true)
    setEditingPetFields(false)
    const { data } = await supabase.from('pets').select('*').eq('id', petId).maybeSingle()
    setPetModalData(data)
    setPetModalLoading(false)
  }

  function closePetModal() {
    setPetModalOpen(false)
    setPetModalData(null)
    setEditingPetFields(false)
  }

  function startEditPetFields(pet: Pet) {
    setEditPetName(pet.name)
    setEditPetSpecies(pet.species)
    setEditPetBreed(pet.breed ?? '')
    setEditPetDob(pet.date_of_birth ?? '')
    setEditPetOwnerName(pet.owner_name)
    setEditPetOwnerPhone(stripSaudiPrefix(pet.owner_phone))
    setEditPetOwnerEmail(pet.owner_email ?? '')
    setPetEditError(null)
    setEditingPetFields(true)
  }

  async function handleSavePetEdit(e: FormEvent, pet: Pet) {
    e.preventDefault()
    setPetEditError(null)

    if (!editPetName.trim() || !editPetSpecies || !editPetOwnerName.trim()) {
      setPetEditError(t('admin.petEditInvalid'))
      return
    }
    if (editPetOwnerPhone && !isValidSaudiMobile(editPetOwnerPhone)) {
      setPetEditError(t('registerPet.invalidPhone'))
      return
    }

    setSavingPetEdit(true)
    const { data, error } = await supabase
      .from('pets')
      .update({
        name: editPetName.trim(),
        species: editPetSpecies,
        breed: editPetBreed || null,
        date_of_birth: editPetDob || null,
        owner_name: editPetOwnerName.trim(),
        owner_phone: editPetOwnerPhone ? `+966${editPetOwnerPhone}` : null,
        owner_email: editPetOwnerEmail || null,
      })
      .eq('id', pet.id)
      .select()
      .single()

    if (error || !data) {
      setPetEditError(error?.message ?? t('common.couldNotSave'))
      setSavingPetEdit(false)
      return
    }

    setPetModalData(data)
    if (currentProfile) {
      await logAdminAction(currentProfile.id, currentProfile.full_name, 'pet_updated', 'pet', data.name, data.clinic_id)
    }
    toast.success(t('admin.petUpdated', { name: data.name }))
    setEditingPetFields(false)
    setSavingPetEdit(false)
  }

  function jumpToClinic(clinicId: string) {
    closePetModal()
    closeUserModal()
    setClinicSearch('')
    setExpandedClinicId(clinicId)
    flashAndScrollTo(`admin-clinic-${clinicId}`, clinicId)
  }

  if (loading) return <LoadingScreen />

  return (
    <div>
      <h1>{t('admin.title')}</h1>

      <div className="pet-picker" style={{ position: 'relative', marginBottom: '1rem' }}>
        <input
          type="search"
          className="search-input"
          placeholder={t('admin.globalSearchPlaceholder')}
          value={globalQuery}
          onChange={(e) => setGlobalQuery(e.target.value)}
        />
        {globalResults && (
          <div className="pet-picker-empty" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {globalResults.length === 0 ? (
              <p>{t('admin.globalSearchNoResults')}</p>
            ) : (
              <ul className="pet-list">
                {globalResults.map((r) => (
                  <li key={`${r.type}-${r.id}`} className="pet-list-item">
                    <button type="button" className="pet-row-toggle" onClick={() => handleSearchResultClick(r)}>
                      <Search size={14} aria-hidden style={{ marginInlineEnd: '0.4rem', opacity: 0.6 }} />
                      <strong>{r.label}</strong>
                      <span className="pet-owner"> · {r.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">
            {clinics.length - trashedClinics.length}
          </div>
          <div className="stat-label">{t('admin.clinics')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">
            {activeClinicCount}
          </div>
          <div className="stat-label">{t('admin.activeClinics')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">
            {dormantClinicCount}
          </div>
          <div className="stat-label">{t('admin.dormantClinics')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">
            {profiles.length}
          </div>
          <div className="stat-label">{t('admin.users')}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-number" dir="ltr">
            {disabledCount}
          </div>
          <div className="stat-label">{t('admin.disabledBadge')}</div>
        </div>
      </div>

      <h2>{t('admin.usageDashboard')}</h2>
      <p className="pet-owner">{t('admin.appointmentsPerWeek')}</p>
      <SimpleBarChart data={weeklyChartData} />

      <div className="panel-header">
        <h2>
          {t('admin.clinics')} ({filteredClinics.length})
        </h2>
        <div className="page-header-actions">
          <button type="button" className="secondary-button" onClick={handleExportClinicsCsv}>
            <Download size={14} aria-hidden style={{ marginInlineEnd: '0.3rem' }} />
            {t('admin.exportCsv')}
          </button>
          <button type="button" className="secondary-button" onClick={() => setShowNewClinicForm((v) => !v)}>
            {showNewClinicForm ? t('common.cancel') : `+ ${t('admin.newClinic')}`}
          </button>
        </div>
      </div>

      {showNewClinicForm && (
        <form onSubmit={handleCreateClinic} className="pet-form pet-form-grid">
          {createError && <p className="form-error">{createError}</p>}
          <label>
            {t('admin.clinicNameField')}
            <RequiredMark />
            <input value={newClinicName} onChange={(e) => setNewClinicName(e.target.value)} required />
          </label>
          <label>
            {t('admin.vetFullName')}
            <RequiredMark />
            <input value={newVetFullName} onChange={(e) => setNewVetFullName(e.target.value)} required />
          </label>
          <label>
            {t('admin.vetEmail')}
            <RequiredMark />
            <input type="email" value={newVetEmail} onChange={(e) => setNewVetEmail(e.target.value)} required />
          </label>
          <label>
            {t('admin.vetPassword')}
            <RequiredMark />
            <input
              type="password"
              value={newVetPassword}
              onChange={(e) => setNewVetPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          <label>
            {t('common.phone')}
            <PhoneInput value={newVetPhone} onChange={setNewVetPhone} invalidMessage={t('registerPet.invalidPhone')} />
          </label>
          <button type="submit" className="primary-button" disabled={creatingClinic}>
            {creatingClinic ? t('common.saving') : t('admin.createClinic')}
          </button>
        </form>
      )}

      <input
        type="search"
        className="search-input"
        placeholder={t('admin.searchClinics')}
        value={clinicSearch}
        onChange={(e) => setClinicSearch(e.target.value)}
      />

      {filteredClinics.length > 0 && (
        <div className="bulk-actions-bar">
          <label className="bulk-select-all">
            <input
              type="checkbox"
              className="admin-checkbox"
              checked={selectedClinicIds.size === filteredClinics.length}
              onChange={toggleSelectAllClinics}
            />
            {t('admin.selectAll')}
          </label>
          {selectedClinicIds.size > 0 && (
            <>
              <div className="bulk-actions-group">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleBulkDisableClinics(true)}
                  disabled={bulkClinicsBusy}
                >
                  {t('admin.bulkDisableClinics', { count: String(selectedClinicIds.size) })}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleBulkDisableClinics(false)}
                  disabled={bulkClinicsBusy}
                >
                  {t('admin.bulkEnableClinics', { count: String(selectedClinicIds.size) })}
                </button>
              </div>
              <button type="button" className="delete-button bulk-danger-action" onClick={handleBulkTrashClinics} disabled={bulkClinicsBusy}>
                {bulkClinicsBusy
                  ? t('common.saving')
                  : t('admin.bulkTrashClinics', { count: String(selectedClinicIds.size) })}
              </button>
            </>
          )}
        </div>
      )}

      {filteredClinics.length === 0 ? (
        <p>{t('admin.noClinicsMatch')}</p>
      ) : (
        <ul className="record-list">
          {filteredClinics.map((clinic) => {
            const clinicVets = profiles.filter((p) => p.clinic_id === clinic.id)
            const expanded = expandedClinicId === clinic.id
            const isEditing = editingClinicId === clinic.id
            return (
              <li
                key={clinic.id}
                id={`admin-clinic-${clinic.id}`}
                className={`record-accordion-item${jumpHighlightId === clinic.id ? ' just-updated' : ''}`}
              >
                <div className="record-accordion-header-row">
                  <input
                    type="checkbox"
                    className="admin-checkbox"
                    checked={selectedClinicIds.has(clinic.id)}
                    onChange={() => toggleClinicSelected(clinic.id)}
                    aria-label={t('admin.selectClinic', { name: clinic.name })}
                  />
                  <button
                    type="button"
                    className="record-accordion-header"
                    onClick={() => setExpandedClinicId(expanded ? null : clinic.id)}
                    aria-expanded={expanded}
                  >
                    <span>
                      <strong>{clinic.name}</strong>{' '}
                      <span className={`status-badge status-${clinic.billing_status}`}>{billingStatusLabel(clinic.billing_status)}</span>{' '}
                      {((recentActivityByClinic[clinic.id]?.pets24h ?? 0) >= ABUSE_SIGNAL_PETS_24H ||
                        (recentActivityByClinic[clinic.id]?.appointments24h ?? 0) >= ABUSE_SIGNAL_APPOINTMENTS_24H) && (
                        <span className="status-badge status-overdue" title={t('admin.abuseSignalHint')}>
                          {t('admin.abuseSignal')}
                        </span>
                      )}
                      <div className="pet-owner">
                        {t('admin.clinicStats', {
                          vets: String(clinicVets.length),
                          staff: String(staffCounts[clinic.id] ?? 0),
                          pets: String(petCounts[clinic.id] ?? 0),
                          appointments: String(appointmentCounts[clinic.id] ?? 0),
                        })}
                      </div>
                    </span>
                    <ChevronDown
                      size={18}
                      aria-hidden
                      className={`record-accordion-chevron${expanded ? ' record-accordion-chevron-open' : ''}`}
                    />
                  </button>
                </div>
                {expanded && (
                  <div className="record-accordion-body">
                    {isEditing ? (
                      <form onSubmit={(e) => handleSaveClinicEdit(e, clinic)} className="pet-form">
                        <label>
                          {t('admin.clinicNameField')}
                          <RequiredMark />
                          <input value={editClinicName} onChange={(e) => setEditClinicName(e.target.value)} required />
                        </label>
                        <label>
                          {t('admin.billingStatus')}
                          <select value={editClinicBillingStatus} onChange={(e) => setEditClinicBillingStatus(e.target.value)}>
                            {BILLING_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {billingStatusLabel(s)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="record-edit-actions">
                          <button type="submit" disabled={savingClinicEdit}>
                            {savingClinicEdit ? t('common.saving') : t('common.save')}
                          </button>
                          <button type="button" className="cancel-button" onClick={() => setEditingClinicId(null)}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="panel-header">
                        <p className="pet-owner">
                          {t('admin.createdOn')}: <Ltr>{new Date(clinic.created_at).toLocaleDateString()}</Ltr>
                          {clinic.disabled && <span className="status-badge status-cancelled"> {t('admin.disabledBadge')}</span>}
                        </p>
                        <div className="page-header-actions">
                          <button type="button" className="secondary-button" onClick={() => startEditClinic(clinic)}>
                            {t('common.edit')}
                          </button>
                          <button type="button" className="secondary-button" onClick={() => startAddStaff(clinic.id)}>
                            + {t('admin.addUser')}
                          </button>
                          <button type="button" className="secondary-button" onClick={() => openClinicActivity(clinic.id)}>
                            {t('admin.viewActivity')}
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleToggleClinicDisabled(clinic)}
                            disabled={togglingClinicId === clinic.id}
                          >
                            {togglingClinicId === clinic.id
                              ? t('common.saving')
                              : clinic.disabled
                                ? t('admin.enable')
                                : t('admin.disable')}
                          </button>
                          <button
                            type="button"
                            className="delete-button bulk-danger-action"
                            onClick={() => handleTrashClinic(clinic)}
                            disabled={deletingClinicId === clinic.id}
                          >
                            {deletingClinicId === clinic.id ? t('common.saving') : t('admin.moveToTrash')}
                          </button>
                        </div>
                      </div>
                    )}
                    {addStaffClinicId === clinic.id && (
                      <form onSubmit={(e) => handleAddStaff(e, clinic.id)} className="pet-form pet-form-grid">
                        {addStaffError && <p className="form-error">{addStaffError}</p>}
                        <label>
                          {t('admin.vetFullName')}
                          <RequiredMark />
                          <input value={addStaffFullName} onChange={(e) => setAddStaffFullName(e.target.value)} required />
                        </label>
                        <label>
                          {t('admin.vetEmail')}
                          <RequiredMark />
                          <input type="email" value={addStaffEmail} onChange={(e) => setAddStaffEmail(e.target.value)} required />
                        </label>
                        <label>
                          {t('admin.vetPassword')}
                          <RequiredMark />
                          <input
                            type="password"
                            value={addStaffPassword}
                            onChange={(e) => setAddStaffPassword(e.target.value)}
                            required
                            minLength={6}
                          />
                        </label>
                        <label>
                          {t('common.phone')}
                          <PhoneInput value={addStaffPhone} onChange={setAddStaffPhone} invalidMessage={t('registerPet.invalidPhone')} />
                        </label>
                        <div className="record-edit-actions">
                          <button type="submit" disabled={addingStaff}>
                            {addingStaff ? t('common.saving') : t('admin.createUser')}
                          </button>
                          <button type="button" className="cancel-button" onClick={() => setAddStaffClinicId(null)}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </form>
                    )}
                    {clinicVets.length === 0 ? (
                      <p>{t('admin.noStaffAtClinic')}</p>
                    ) : (
                      <ul className="pet-list">
                        {clinicVets.map((p) => (
                          <li key={p.id} className="pet-list-item">
                            <div className="pet-row">
                              <button type="button" className="pet-row-toggle" onClick={() => openUserModal(p.id)}>
                                {p.full_name} — {roleLabel(p.role)}
                                {p.disabled && <span className="status-badge status-cancelled"> {t('admin.disabledBadge')}</span>}
                              </button>
                              {p.id !== currentProfile?.id && (
                                <button
                                  type="button"
                                  className={p.disabled ? 'secondary-button' : 'delete-button'}
                                  onClick={() => handleToggleDisabled(p)}
                                  disabled={togglingId === p.id}
                                >
                                  {togglingId === p.id ? t('common.saving') : p.disabled ? t('admin.enable') : t('admin.disable')}
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" className="admin-trash-fab" onClick={() => setTrashModalOpen(true)} aria-label={t('admin.trash')}>
        <Trash2 size={20} aria-hidden />
        {trashedClinics.length > 0 && <span className="admin-trash-fab-count">{trashedClinics.length}</span>}
      </button>

      {petModalOpen && (
        <div className="admin-modal-backdrop" onClick={closePetModal}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            {petModalLoading ? (
              <p>{t('common.loading')}</p>
            ) : !petModalData ? (
              <p>{t('admin.petNotFound')}</p>
            ) : (
              <>
                <h2>{petModalData.name}</h2>
                <p className="pet-owner">{speciesLabel(t, petModalData.species)}{petModalData.breed ? ` · ${petModalData.breed}` : ''}</p>

                {!editingPetFields && (
                  <div className="admin-pet-modal-fields">
                    {petModalData.date_of_birth && (
                      <p>
                        <strong>{t('registerPet.dateOfBirth')}:</strong>{' '}
                        <Ltr>{new Date(petModalData.date_of_birth).toLocaleDateString()}</Ltr>
                      </p>
                    )}
                    <p>
                      <strong>{t('registerPet.ownerName')}:</strong> {petModalData.owner_name}
                    </p>
                    {petModalData.owner_phone && (
                      <p>
                        <strong>{t('common.phone')}:</strong> <Ltr>{petModalData.owner_phone}</Ltr>
                      </p>
                    )}
                    {petModalData.owner_email && (
                      <p>
                        <strong>{t('registerPet.ownerEmail')}:</strong> {petModalData.owner_email}
                      </p>
                    )}
                    {petModalData.next_vaccination_date && (
                      <p>
                        <strong>{t('vaccination.nextDue')}:</strong>{' '}
                        <Ltr>{new Date(petModalData.next_vaccination_date).toLocaleDateString()}</Ltr>
                      </p>
                    )}
                    <p>
                      <strong>{t('admin.clinics')}:</strong> {clinicNameById[petModalData.clinic_id] ?? '—'}
                    </p>
                  </div>
                )}

                {editingPetFields ? (
                  <form onSubmit={(e) => handleSavePetEdit(e, petModalData)} className="pet-form">
                    {petEditError && <p className="form-error">{petEditError}</p>}
                    <label>
                      {t('common.name')}
                      <RequiredMark />
                      <input value={editPetName} onChange={(e) => setEditPetName(e.target.value)} required />
                    </label>
                    <label>
                      {t('registerPet.species')}
                      <RequiredMark />
                      <select value={editPetSpecies} onChange={(e) => setEditPetSpecies(e.target.value)} required>
                        <option value="" disabled>
                          {t('registerPet.selectSpecies')}
                        </option>
                        {POPULAR_SPECIES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {speciesLabel(t, s.value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('registerPet.breed')}
                      <input value={editPetBreed} onChange={(e) => setEditPetBreed(e.target.value)} />
                    </label>
                    <label>
                      {t('registerPet.dateOfBirth')}
                      <input type="date" dir="ltr" value={editPetDob} onChange={(e) => setEditPetDob(e.target.value)} />
                    </label>
                    <label>
                      {t('registerPet.ownerName')}
                      <RequiredMark />
                      <input value={editPetOwnerName} onChange={(e) => setEditPetOwnerName(e.target.value)} required />
                    </label>
                    <label>
                      {t('registerPet.ownerPhone')}
                      <PhoneInput value={editPetOwnerPhone} onChange={setEditPetOwnerPhone} invalidMessage={t('registerPet.invalidPhone')} />
                    </label>
                    <label>
                      {t('registerPet.ownerEmail')}
                      <input type="email" value={editPetOwnerEmail} onChange={(e) => setEditPetOwnerEmail(e.target.value)} />
                    </label>
                    <div className="record-edit-actions">
                      <button type="submit" disabled={savingPetEdit}>
                        {savingPetEdit ? t('common.saving') : t('common.save')}
                      </button>
                      <button type="button" className="cancel-button" onClick={() => setEditingPetFields(false)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="admin-modal-actions">
                    <button type="button" className="secondary-button" onClick={() => jumpToClinic(petModalData.clinic_id)}>
                      {t('admin.viewClinic')}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => startEditPetFields(petModalData)}>
                      {t('common.edit')}
                    </button>
                    <button type="button" className="cancel-button" onClick={closePetModal}>
                      {t('common.close')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {userModalId &&
        (() => {
          const userModalProfile = profiles.find((p) => p.id === userModalId)
          return (
            <div className="admin-modal-backdrop" onClick={closeUserModal}>
              <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
                {!userModalProfile ? (
                  <p>{t('admin.userNotFound')}</p>
                ) : (
                  <>
                    <h2>
                      {userModalProfile.full_name}{' '}
                      {userModalProfile.disabled && (
                        <span className="status-badge status-cancelled">{t('admin.disabledBadge')}</span>
                      )}
                    </h2>
                    <p className="pet-owner">{roleLabel(userModalProfile.role)}</p>

                    {!editingUserFields && (
                      <div className="admin-pet-modal-fields">
                        {userModalProfile.clinic_id && (
                          <p>
                            <strong>{t('admin.clinics')}:</strong> {clinicNameById[userModalProfile.clinic_id] ?? '—'}
                          </p>
                        )}
                        {userModalProfile.phone && (
                          <p>
                            <strong>{t('common.phone')}:</strong> <Ltr>{userModalProfile.phone}</Ltr>
                          </p>
                        )}
                        <p>
                          <strong>{t('admin.memberSince')}:</strong>{' '}
                          <Ltr>{new Date(userModalProfile.created_at).toLocaleDateString()}</Ltr>
                        </p>
                        {userModalLoading ? (
                          <p>{t('common.loading')}</p>
                        ) : (
                          userModalStats && (
                            <>
                              <p>
                                <strong>{t('admin.appointmentsCreated')}:</strong> {userModalStats.appointmentsCreated}
                              </p>
                              <p>
                                <strong>{t('admin.recordsAuthored')}:</strong> {userModalStats.recordsAuthored}
                              </p>
                              <p>
                                <strong>{t('admin.pushNotifications')}:</strong>{' '}
                                {userModalStats.pushSubscriptions > 0
                                  ? t('admin.pushEnabledCount', { count: String(userModalStats.pushSubscriptions) })
                                  : t('admin.pushDisabled')}
                              </p>
                            </>
                          )
                        )}
                      </div>
                    )}

                    {editingUserFields ? (
                      <form onSubmit={(e) => handleSaveUserEdit(e, userModalProfile)} className="pet-form">
                        {userEditError && <p className="form-error">{userEditError}</p>}
                        <label>
                          {t('common.name')}
                          <RequiredMark />
                          <input value={editUserFullName} onChange={(e) => setEditUserFullName(e.target.value)} required />
                        </label>
                        <label>
                          {t('common.phone')}
                          <PhoneInput value={editUserPhone} onChange={setEditUserPhone} invalidMessage={t('registerPet.invalidPhone')} />
                        </label>
                        <label>
                          {t('admin.roleField')}
                          <select value={editUserRole} onChange={(e) => setEditUserRole(e.target.value)}>
                            <option value="vet">{t('role.vet')}</option>
                            <option value="owner">{t('role.owner')}</option>
                            <option value="admin">{t('role.admin')}</option>
                          </select>
                        </label>
                        {editUserRole === 'vet' && (
                          <label>
                            {t('admin.clinics')}
                            <RequiredMark />
                            <select value={editUserClinicId} onChange={(e) => setEditUserClinicId(e.target.value)} required>
                              <option value="" disabled>
                                {t('admin.selectClinicField')}
                              </option>
                              {clinics
                                .filter((c) => !c.deleted_at)
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        <div className="record-edit-actions">
                          <button type="submit" disabled={savingUserEdit}>
                            {savingUserEdit ? t('common.saving') : t('common.save')}
                          </button>
                          <button type="button" className="cancel-button" onClick={() => setEditingUserFields(false)}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </form>
                    ) : showResetPassword ? (
                      <form onSubmit={(e) => handleResetPassword(e, userModalProfile.id)} className="pet-form">
                        {resetPasswordError && <p className="form-error">{resetPasswordError}</p>}
                        <label>
                          {t('admin.newPasswordField')}
                          <RequiredMark />
                          <input
                            type="password"
                            value={resetPasswordValue}
                            onChange={(e) => setResetPasswordValue(e.target.value)}
                            required
                            minLength={6}
                          />
                        </label>
                        <div className="record-edit-actions">
                          <button type="submit" disabled={resettingPassword}>
                            {resettingPassword ? t('common.saving') : t('admin.resetPassword')}
                          </button>
                          <button
                            type="button"
                            className="cancel-button"
                            onClick={() => {
                              setShowResetPassword(false)
                              setResetPasswordValue('')
                              setResetPasswordError(null)
                            }}
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="admin-modal-actions">
                        {userModalProfile.clinic_id && (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => jumpToClinic(userModalProfile.clinic_id!)}
                          >
                            {t('admin.viewClinic')}
                          </button>
                        )}
                        <button type="button" className="secondary-button" onClick={() => startEditUserFields(userModalProfile)}>
                          {t('common.edit')}
                        </button>
                        <button type="button" className="secondary-button" onClick={() => setShowResetPassword(true)}>
                          {t('admin.resetPassword')}
                        </button>
                        {userModalProfile.id !== currentProfile?.id && (
                          <button
                            type="button"
                            className={userModalProfile.disabled ? 'secondary-button' : 'delete-button'}
                            onClick={() => handleToggleDisabled(userModalProfile)}
                            disabled={togglingId === userModalProfile.id}
                          >
                            {togglingId === userModalProfile.id
                              ? t('common.saving')
                              : userModalProfile.disabled
                                ? t('admin.enable')
                                : t('admin.disable')}
                          </button>
                        )}
                        <button type="button" className="cancel-button" onClick={closeUserModal}>
                          {t('common.close')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })()}

      {trashModalOpen && (
        <div className="admin-modal-backdrop" onClick={() => setTrashModalOpen(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>
              {t('admin.trash')} ({trashedClinics.length})
            </h2>
            {trashedClinics.length === 0 ? (
              <p>{t('admin.trashEmpty')}</p>
            ) : (
              <ul className="record-list">
                {trashedClinics.map((clinic) => {
                  const deletedAt = new Date(clinic.deleted_at!)
                  const daysLeft = Math.max(
                    0,
                    TRASH_RETENTION_DAYS - Math.floor((Date.now() - deletedAt.getTime()) / (24 * 60 * 60 * 1000)),
                  )
                  return (
                    <li key={clinic.id}>
                      <div className="record-row">
                        <div>
                          <strong>{clinic.name}</strong>
                          <div className="pet-owner">
                            {t('admin.trashedOn')}: <Ltr>{deletedAt.toLocaleDateString()}</Ltr> ·{' '}
                            {t('admin.daysUntilPurge', { count: String(daysLeft) })}
                          </div>
                        </div>
                        <div className="record-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleRestoreClinic(clinic)}
                            disabled={restoringClinicId === clinic.id}
                          >
                            {restoringClinicId === clinic.id ? t('common.saving') : t('admin.restore')}
                          </button>
                          <button
                            type="button"
                            className="delete-button"
                            onClick={() => handlePurgeClinic(clinic)}
                            disabled={deletingClinicId === clinic.id}
                          >
                            {deletingClinicId === clinic.id ? t('common.saving') : t('admin.purgeNow')}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="admin-modal-actions">
              <button type="button" className="cancel-button" onClick={() => setTrashModalOpen(false)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {activityModalClinicId && (
        <div className="admin-modal-backdrop" onClick={() => setActivityModalClinicId(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>
              {t('admin.activityLog')} — {clinicNameById[activityModalClinicId] ?? ''}
            </h2>
            {loadingClinicActivity ? (
              <p>{t('common.loading')}</p>
            ) : clinicActivity.length === 0 ? (
              <p>{t('admin.noActivity')}</p>
            ) : (
              <ul className="record-list">
                {clinicActivity.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.actor_name}</strong> {auditActionLabel(entry.action)}
                    {entry.target_label ? ` — ${entry.target_label}` : ''}
                    <div className="record-date">
                      <Ltr>{new Date(entry.created_at).toLocaleString()}</Ltr>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="admin-modal-actions">
              <button type="button" className="cancel-button" onClick={() => setActivityModalClinicId(null)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminPage
