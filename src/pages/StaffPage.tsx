import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import type { Database } from '../lib/database.types'
import { isValidSaudiMobile, stripSaudiPrefix } from '../lib/phone'
import { MIN_PASSWORD_LENGTH, parseStaffLogin, staffChangeError } from '../../supabase/functions/_shared/staffRules'
import type { ClinicRole, StaffChange } from '../../supabase/functions/_shared/staffRules'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import StaffAppointments from '../components/StaffAppointments'
import PhoneInput from '../components/PhoneInput'
import RefreshButton from '../components/RefreshButton'
import RequiredMark from '../components/RequiredMark'
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning'

type Branch = Database['public']['Tables']['branches']['Row']
type Member = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'full_name' | 'username' | 'email' | 'title' | 'phone' | 'clinic_role' | 'takes_appointments' | 'disabled'
> & { staff_branches: { branch_id: string }[] }

type Draft = {
  fullName: string
  username: string
  password: string
  title: string
  phone: string
  role: ClinicRole
  branchIds: string[]
  takesAppointments: boolean
}

// Managers are created by admins only, so the page never offers that role.
const ASSIGNABLE_ROLES: ClinicRole[] = ['doctor', 'nurse', 'receptionist']

const EMPTY_DRAFT: Draft = {
  fullName: '',
  username: '',
  password: '',
  title: '',
  phone: '',
  role: 'doctor',
  branchIds: [],
  takesAppointments: true,
}

function StaffPage() {
  const { profile } = useAuth()
  const { t, language } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const isManager = profile?.clinic_role === 'manager'

  const [staff, setStaff] = useState<Member[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT)
  const [savingEdit, setSavingEdit] = useState(false)

  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useUnsavedChangesWarning(
    Boolean(newDraft.fullName || newDraft.username || newDraft.password || newDraft.title || newDraft.phone) ||
      editingId !== null,
  )

  async function fetchAll() {
    const [staffRes, branchRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, username, email, title, phone, clinic_role, takes_appointments, disabled, staff_branches(branch_id)')
        .eq('role', 'vet')
        .eq('clinic_id', profile?.clinic_id ?? '')
        .order('full_name', { ascending: true }),
      supabase.from('branches').select('*').eq('active', true).order('is_main', { ascending: false }).order('name'),
    ])
    const fetchError = staffRes.error ?? branchRes.error
    if (fetchError) {
      setError(fetchError.message)
      return
    }
    setStaff(staffRes.data ?? [])
    setBranches(branchRes.data ?? [])
    return branchRes.data ?? []
  }

  // Re-fetches without the full-page LoadingScreen (which would collapse an
  // expanded staff member's appointments panel).
  async function handleRefresh() {
    setRefreshing(true)
    await fetchAll()
    setRefreshing(false)
  }

  useEffect(() => {
    if (!profile?.clinic_id) return
    fetchAll().then(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once the profile is known
  }, [profile?.clinic_id])

  // The caller as the shared server rules see it: a manager with no branch rows covers the whole clinic.
  const me = staff.find((m) => m.id === profile?.id)
  const myBranchIds = me && me.staff_branches.length > 0 ? me.staff_branches.map((b) => b.branch_id) : null
  const assignableBranches = myBranchIds ? branches.filter((b) => myBranchIds.includes(b.id)) : branches

  // Only one branch this manager can assign: nothing to choose, so preselect it.
  const onlyBranchId = assignableBranches.length === 1 ? assignableBranches[0].id : null
  useEffect(() => {
    if (onlyBranchId) setNewDraft((d) => (d.branchIds.length ? d : { ...d, branchIds: [onlyBranchId] }))
  }, [onlyBranchId])

  // Same check the edge function runs, so the page never offers what the server will refuse.
  function allowed(member: Member, change: StaffChange) {
    if (!isManager || !profile) return false
    return (
      staffChangeError(
        { id: profile.id, isAdmin: false, branchIds: myBranchIds },
        {
          id: member.id,
          clinicRole: member.clinic_role as ClinicRole,
          disabled: member.disabled,
          branchIds: member.staff_branches.map((b) => b.branch_id),
        },
        change,
        // Managers can never be disabled from here, so the last-manager guard never applies.
        Infinity,
      ) === null
    )
  }

  async function invokeStaff(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('clinic-manage-staff', { body })
    if (!error && !data?.error) return null
    // On a non-2xx reply supabase-js leaves data empty; the { error } body is on the raw response.
    const detail = error?.context instanceof Response ? (await error.context.json().catch(() => null))?.error : null
    return (data?.error ?? detail ?? error?.message ?? t('common.couldNotSave')) as string
  }

  function branchLabel(branch: Branch) {
    return language === 'ar' && branch.name_ar ? branch.name_ar : branch.name
  }

  function memberBranches(member: Member) {
    if (member.staff_branches.length === 0) return member.clinic_role === 'manager' ? t('staff.allBranches') : ''
    return member.staff_branches
      .map((sb) => branches.find((b) => b.id === sb.branch_id))
      .filter((b): b is Branch => Boolean(b))
      .map(branchLabel)
      .join(language === 'ar' ? '، ' : ', ')
  }

  // Returns an error message, or null when the draft is valid.
  function validate(d: Draft, isNew: boolean, withBranches: boolean) {
    if (isNew && !parseStaffLogin(d.username)) return t('staff.invalidUsername')
    if ((isNew || d.password) && d.password.length < MIN_PASSWORD_LENGTH)
      return t('staff.passwordTooShort', { min: String(MIN_PASSWORD_LENGTH) })
    if (withBranches && d.branchIds.length === 0) return t('staff.needBranch')
    if (d.phone && !isValidSaudiMobile(d.phone)) return t('registerPet.invalidPhone')
    return null
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const d = { ...newDraft, username: newDraft.username.trim().toLowerCase() }
    const invalid = validate(d, true, true)
    setError(invalid)
    if (invalid) return

    setSaving(true)
    const failure = await invokeStaff({
      action: 'create_staff',
      username: d.username,
      password: d.password,
      fullName: d.fullName.trim(),
      clinicRole: d.role,
      branchIds: d.branchIds,
      phone: d.phone ? `+966${d.phone}` : null,
      title: d.title.trim() || null,
      takesAppointments: d.takesAppointments,
    })
    setSaving(false)
    if (failure) {
      setError(failure)
      return
    }
    toast.success(t('staff.added', { name: d.fullName.trim(), username: d.username }))
    setNewDraft({ ...EMPTY_DRAFT, branchIds: assignableBranches.length === 1 ? [assignableBranches[0].id] : [] })
    await fetchAll()
  }

  function startEditing(member: Member) {
    setError(null)
    setEditingId(member.id)
    setEditDraft({
      ...EMPTY_DRAFT,
      fullName: member.full_name,
      title: member.title ?? '',
      phone: stripSaudiPrefix(member.phone),
      role: member.clinic_role as ClinicRole,
      branchIds: member.staff_branches.map((b) => b.branch_id),
      takesAppointments: member.takes_appointments,
    })
  }

  async function handleSaveEdit(e: FormEvent, member: Member) {
    e.preventDefault()
    const d = editDraft
    const canBranches = member.id !== profile?.id && allowed(member, { action: 'set_branches' })
    const invalid = validate(d, false, canBranches)
    setError(invalid)
    if (invalid) return

    setSavingEdit(true)
    const oldBranches = member.staff_branches.map((b) => b.branch_id)
    const steps: Record<string, unknown>[] = [
      {
        action: 'update_staff',
        fullName: d.fullName.trim(),
        title: d.title.trim() || null,
        phone: d.phone ? `+966${d.phone}` : null,
        takesAppointments: d.takesAppointments,
      },
    ]
    if (canBranches && d.role !== member.clinic_role) steps.push({ action: 'set_role', clinicRole: d.role })
    if (canBranches && (d.branchIds.length !== oldBranches.length || d.branchIds.some((id) => !oldBranches.includes(id))))
      steps.push({ action: 'set_branches', branchIds: d.branchIds })
    if (d.password) steps.push({ action: 'reset_password', newPassword: d.password })

    for (const step of steps) {
      const failure = await invokeStaff({ ...step, userId: member.id })
      if (failure) {
        setError(failure)
        setSavingEdit(false)
        await fetchAll()
        return
      }
    }
    toast.success(t('staff.saved', { name: d.fullName.trim() }))
    setEditingId(null)
    setSavingEdit(false)
    await fetchAll()
  }

  async function setDisabled(member: Member, disabled: boolean) {
    if (disabled) {
      const ok = await confirm(t('staff.removeConfirm', { name: member.full_name }), {
        danger: true,
        confirmLabel: t('staff.removeMember'),
      })
      if (!ok) return
    }
    setBusyId(member.id)
    const failure = await invokeStaff({ action: 'set_disabled', userId: member.id, disabled })
    setBusyId(null)
    if (failure) {
      toast.error(failure)
      return
    }
    toast.success(t(disabled ? 'staff.removed' : 'staff.restored', { name: member.full_name }))
    await fetchAll()
  }

  function renderFields(d: Draft, set: (d: Draft) => void, opts: { isNew: boolean; roleAndBranches: boolean }) {
    return (
      <>
        <label>
          {t('common.name')}
          <RequiredMark />
          <input value={d.fullName} onChange={(e) => set({ ...d, fullName: e.target.value })} required />
        </label>
        {opts.isNew && (
          <label>
            {t('staff.username')}
            <RequiredMark />
            <input
              value={d.username}
              onChange={(e) => set({ ...d, username: e.target.value })}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              required
            />
          </label>
        )}
        <label>
          {opts.isNew ? t('staff.password') : t('staff.newPassword')}
          {opts.isNew && <RequiredMark />}
          <input
            type="password"
            value={d.password}
            onChange={(e) => set({ ...d, password: e.target.value })}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required={opts.isNew}
          />
        </label>
        {opts.roleAndBranches && (
          <label>
            {t('staff.roleField')}
            <RequiredMark />
            <select
              value={d.role}
              onChange={(e) => {
                const role = e.target.value as ClinicRole
                set({ ...d, role, takesAppointments: opts.isNew ? role === 'doctor' : d.takesAppointments })
              }}
            >
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`staff.role.${role}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        {opts.roleAndBranches && (
          <fieldset className="checkbox-group">
            <legend>
              {t('staff.branches')}
              <RequiredMark />
            </legend>
            {assignableBranches.map((branch) => (
              <label key={branch.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={d.branchIds.includes(branch.id)}
                  onChange={(e) =>
                    set({
                      ...d,
                      branchIds: e.target.checked ? [...d.branchIds, branch.id] : d.branchIds.filter((id) => id !== branch.id),
                    })
                  }
                />
                {branchLabel(branch)}
              </label>
            ))}
          </fieldset>
        )}
        <label>
          {t('staff.titleField')}
          <input value={d.title} onChange={(e) => set({ ...d, title: e.target.value })} placeholder={t('staff.titlePlaceholder')} />
        </label>
        <label>
          {t('common.phone')}
          <PhoneInput value={d.phone} onChange={(phone) => set({ ...d, phone })} invalidMessage={t('registerPet.invalidPhone')} />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={d.takesAppointments}
            onChange={(e) => set({ ...d, takesAppointments: e.target.checked })}
          />
          {t('staff.takesAppointments')}
        </label>
      </>
    )
  }

  if (loading) return <LoadingScreen />

  const active = staff.filter((m) => !m.disabled)
  const removed = staff.filter((m) => m.disabled)

  function renderMeta(member: Member) {
    const branchText = memberBranches(member)
    return (
      <div className="pet-owner">
        {member.clinic_role && t(`staff.role.${member.clinic_role as ClinicRole}`)}
        {(member.username || member.email) && (
          <>
            {' · '}
            <Ltr>{member.username ? `@${member.username}` : member.email}</Ltr>
          </>
        )}
        {member.phone && (
          <>
            {' · '}
            <Ltr>{member.phone}</Ltr>
          </>
        )}
        {branchText && ` · ${branchText}`}
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('staff.title')}</h1>
        <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
      </div>

      {error && <p className="form-error">{error}</p>}

      {active.length === 0 ? (
        <p>{t('staff.none')}</p>
      ) : (
        <ul className="record-list">
          {active.map((member) => {
            const isSelf = member.id === profile?.id
            const canManage = !isSelf && allowed(member, { action: 'update_staff' })
            return editingId === member.id ? (
              <li key={member.id}>
                <form onSubmit={(e) => handleSaveEdit(e, member)} className="pet-form">
                  {renderFields(editDraft, setEditDraft, {
                    isNew: false,
                    roleAndBranches: !isSelf && allowed(member, { action: 'set_branches' }),
                  })}
                  <div className="record-edit-actions">
                    <button type="submit" disabled={savingEdit}>
                      {savingEdit ? t('common.saving') : t('common.save')}
                    </button>
                    <button type="button" className="cancel-button" onClick={() => setEditingId(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={member.id}>
                <div className="record-row">
                  <button
                    type="button"
                    className="pet-row-toggle"
                    onClick={() => setExpandedStaffId(expandedStaffId === member.id ? null : member.id)}
                  >
                    <strong>{member.full_name}</strong>
                    {member.title && ` — ${member.title}`}
                    {renderMeta(member)}
                  </button>
                  {(canManage || (isSelf && isManager)) && (
                    <div className="record-actions">
                      <button type="button" className="secondary-button" onClick={() => startEditing(member)}>
                        {t('common.edit')}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          className="delete-button"
                          onClick={() => setDisabled(member, true)}
                          disabled={busyId === member.id}
                        >
                          {busyId === member.id ? t('common.saving') : t('staff.removeMember')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {expandedStaffId === member.id && <StaffAppointments staffId={member.id} />}
              </li>
            )
          })}
        </ul>
      )}

      {isManager && (
        <form onSubmit={handleAdd} className="pet-form pet-form-grid">
          <h2>{t('staff.addMember')}</h2>
          {renderFields(newDraft, setNewDraft, { isNew: true, roleAndBranches: true })}
          <button type="submit" disabled={saving}>
            {saving ? t('common.saving') : t('staff.addSubmit')}
          </button>
        </form>
      )}

      {removed.length > 0 && (
        <section>
          <h2>{t('staff.removedTitle')}</h2>
          <ul className="record-list">
            {removed.map((member) => (
              <li key={member.id}>
                <div className="record-row">
                  <div>
                    <strong>{member.full_name}</strong>
                    {member.title && ` — ${member.title}`}
                    {renderMeta(member)}
                  </div>
                  {allowed(member, { action: 'set_disabled', disabled: false }) && (
                    <div className="record-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setDisabled(member, false)}
                        disabled={busyId === member.id}
                      >
                        {busyId === member.id ? t('common.saving') : t('trash.restore')}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default StaffPage
