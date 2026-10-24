import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { CLINIC_ROLES, MIN_PASSWORD_LENGTH, parseStaffLogin, staffChangeError } from '../_shared/staffRules.ts'
import type { ClinicRole, StaffCaller, StaffChange, StaffTarget } from '../_shared/staffRules.ts'
import { publishableKey, secretKey } from '../_shared/keys.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!

// Staff accounts of one clinic (docs/design/staff-branches-calendar.md §3).
// Callers: a clinic's manager (their own clinic) or a Touq admin (any clinic,
// passed as clinicId). Who may do what is in _shared/staffRules.ts. Writes use
// the service role; the 0047 profile guard lets it through.
// "Remove staff member" = set_disabled: profile flag (RLS helpers stop
// returning data at once) plus an auth ban so they can't sign in again.
const BAN_FOREVER = '876000h'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  const fail = (error: string, status = 400) => json({ error }, status)

  const admin = createClient(supabaseUrl, secretKey)
  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await callerClient.auth.getUser()
  if (!user) return fail('unauthorized', 401)

  const { data: me } = await admin
    .from('profiles')
    .select('role, clinic_id, clinic_role, disabled, full_name, clinics(disabled)')
    .eq('id', user.id)
    .maybeSingle()
  const isAdmin = me?.role === 'admin' && !me.disabled
  const isManager = me?.role === 'vet' && me.clinic_role === 'manager' && !me.disabled && !me.clinics?.disabled
  if (!isAdmin && !isManager) return fail('forbidden', 403)

  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? '') as StaffChange['action']
  const clinicId = isAdmin ? String(body.clinicId ?? '') : me!.clinic_id!
  if (!clinicId) return fail('Missing clinicId')

  // A manager with branch rows manages only those branches (0047).
  let callerBranches: string[] | null = null
  if (!isAdmin) {
    const { data } = await admin.from('staff_branches').select('branch_id').eq('profile_id', user.id)
    if (data?.length) callerBranches = data.map((r) => r.branch_id)
  }
  const caller: StaffCaller = { id: user.id, isAdmin, branchIds: callerBranches }

  const clinicRole = body.clinicRole === undefined ? undefined : (String(body.clinicRole) as ClinicRole)
  if (clinicRole !== undefined && !CLINIC_ROLES.includes(clinicRole)) return fail('Invalid role')
  const branchIds: string[] | undefined = Array.isArray(body.branchIds) ? [...new Set(body.branchIds.map(String))] : undefined
  if (branchIds?.length) {
    const { data } = await admin.from('branches').select('id').eq('clinic_id', clinicId).eq('active', true).in('id', branchIds)
    if ((data ?? []).length !== branchIds.length) return fail('Unknown branch')
  }

  let target: (StaffTarget & { fullName: string }) | null = null
  if (action !== 'create_staff') {
    const userId = String(body.userId ?? '')
    const { data } = await admin
      .from('profiles')
      .select('id, clinic_role, disabled, full_name, staff_branches(branch_id)')
      .eq('id', userId)
      .eq('clinic_id', clinicId)
      .eq('role', 'vet')
      .maybeSingle()
    if (!data) return fail('Staff member not found', 404)
    target = {
      id: data.id,
      clinicRole: data.clinic_role as ClinicRole,
      disabled: data.disabled,
      branchIds: data.staff_branches.map((r: { branch_id: string }) => r.branch_id),
      fullName: data.full_name,
    }
  }

  const { count: enabledManagers } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('clinic_role', 'manager')
    .eq('disabled', false)

  const disabled = body.disabled === undefined ? undefined : Boolean(body.disabled)
  const denied = staffChangeError(caller, target, { action, clinicRole, branchIds, disabled }, enabledManagers ?? 0)
  if (denied) return fail(denied, 403)

  const log = (logAction: string, label: string) =>
    admin.from('admin_audit_log').insert({
      actor_id: user.id,
      actor_name: me!.full_name,
      action: logAction,
      target_type: 'profile',
      target_label: label,
      clinic_id: clinicId,
    })

  async function setBranches(profileId: string, ids: string[]) {
    // One transaction (0076): a failed insert can't leave a branch manager with no rows (= whole clinic).
    const { error } = await admin.rpc('replace_staff_branches', { p_profile: profileId, p_branches: ids })
    return error?.message ?? null
  }

  const text = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim())

  if (action === 'create_staff') {
    // `username` may also be a real email (admin desk).
    const login = parseStaffLogin(String(body.username ?? ''))
    const password = String(body.password ?? '')
    const fullName = String(body.fullName ?? '').trim()
    if (!login) return fail('Invalid username or email')
    if (password.length < MIN_PASSWORD_LENGTH) return fail('Password too short')
    if (!fullName || !clinicRole || !branchIds) return fail('Missing or invalid fields')

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: login.email,
      password,
      email_confirm: true,
    })
    if (createError || !created.user) {
      const taken = /already|exists|registered/i.test(createError?.message ?? '')
      return fail(taken ? 'Username or email is taken' : (createError?.message ?? 'Could not create account'))
    }

    const newId = created.user.id
    const { error: profileError } = await admin.from('profiles').insert({
      id: newId,
      role: 'vet',
      clinic_id: clinicId,
      clinic_role: clinicRole,
      username: login.username,
      email: login.username ? null : login.email,
      full_name: fullName,
      phone: text(body.phone),
      title: text(body.title),
      takes_appointments: body.takesAppointments === undefined ? clinicRole === 'doctor' : Boolean(body.takesAppointments),
    })
    const branchError = profileError ? null : await setBranches(newId, branchIds)
    if (profileError || branchError) {
      await admin.auth.admin.deleteUser(newId) // cascades to the profile row
      return fail(profileError?.message ?? branchError!)
    }

    await log('staff_added', `${fullName} (${login.username ? '@' + login.username : login.email}, ${clinicRole})`)
    return json({ userId: newId })
  }

  const t = target!

  if (action === 'update_staff') {
    const patch: Record<string, unknown> = {}
    if (body.fullName !== undefined) {
      const fullName = String(body.fullName).trim()
      if (!fullName) return fail('Name is required')
      patch.full_name = fullName
    }
    if (body.phone !== undefined) patch.phone = text(body.phone)
    if (body.title !== undefined) patch.title = text(body.title)
    if (body.takesAppointments !== undefined) patch.takes_appointments = Boolean(body.takesAppointments)
    if (body.calendarOrder !== undefined) patch.calendar_order = body.calendarOrder === null ? null : Number(body.calendarOrder)
    const { error } = await admin.from('profiles').update(patch).eq('id', t.id)
    if (error) return fail(error.message)
    await log('staff_updated', t.fullName)
    return json({ ok: true })
  }

  if (action === 'set_role') {
    if (!clinicRole) return fail('Missing role')
    const { error } = await admin.from('profiles').update({ clinic_role: clinicRole }).eq('id', t.id)
    if (error) return fail(error.message)
    await log('staff_role_changed', `${t.fullName}: ${t.clinicRole} → ${clinicRole}`)
    return json({ ok: true })
  }

  if (action === 'set_branches') {
    if (!branchIds) return fail('Missing branches')
    const error = await setBranches(t.id, branchIds)
    if (error) return fail(error)
    await log('staff_branches_changed', t.fullName)
    return json({ ok: true })
  }

  if (action === 'set_disabled') {
    if (disabled === undefined) return fail('Missing disabled')
    // Ordered so a half-done call leaves the account locked, never half-open.
    const setFlag = () => admin.from('profiles').update({ disabled }).eq('id', t.id)
    const setBan = () => admin.auth.admin.updateUserById(t.id, { ban_duration: disabled ? BAN_FOREVER : 'none' })
    const [first, second] = disabled ? [setFlag, setBan] : [setBan, setFlag]
    const firstError = (await first()).error
    if (firstError) return fail(firstError.message)
    const secondError = (await second()).error
    if (secondError) return fail(secondError.message)
    // Their devices must stop showing this clinic's pet names; they re-enable alerts if restored.
    if (disabled) await admin.from('push_subscriptions').delete().eq('profile_id', t.id)
    await log(disabled ? 'staff_disabled' : 'staff_enabled', t.fullName)
    return json({ ok: true })
  }

  // Admin only (staffRules). Auth first: it refuses a taken address, and the
  // profile copy follows; if that fails, the old auth email is put back.
  if (action === 'set_login') {
    const login = parseStaffLogin(String(body.username ?? ''))
    if (!login) return fail('Invalid username or email')
    const { data: before } = await admin.auth.admin.getUserById(t.id)
    const { error: authError } = await admin.auth.admin.updateUserById(t.id, { email: login.email, email_confirm: true })
    if (authError) {
      const taken = /already|exists|registered/i.test(authError.message)
      return fail(taken ? 'Username or email is taken' : authError.message)
    }
    const { error } = await admin
      .from('profiles')
      .update({ username: login.username, email: login.username ? null : login.email })
      .eq('id', t.id)
    if (error) {
      if (before.user?.email) await admin.auth.admin.updateUserById(t.id, { email: before.user.email, email_confirm: true })
      return fail(error.message)
    }
    await log('staff_login_changed', `${t.fullName}: ${login.username ? '@' + login.username : login.email}`)
    return json({ ok: true })
  }

  if (action === 'reset_password') {
    const newPassword = String(body.newPassword ?? '')
    if (newPassword.length < MIN_PASSWORD_LENGTH) return fail('Password too short')
    const { error } = await admin.auth.admin.updateUserById(t.id, { password: newPassword })
    if (error) return fail(error.message)
    await log('password_reset', t.fullName)
    return json({ ok: true })
  }

  return fail('Unknown action')
})
