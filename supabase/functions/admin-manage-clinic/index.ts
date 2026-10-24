import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { MIN_PASSWORD_LENGTH, parseStaffLogin } from '../_shared/staffRules.ts'
import { publishableKey, secretKey } from '../_shared/keys.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const cronPurgeSecret = Deno.env.get('CRON_PURGE_SECRET')!

const TRASH_RETENTION_DAYS = 7

// Clinic/vet onboarding is admin-only now that the public signup form is
// gone — this is the one place a brand new auth user (the clinic's first
// vet) gets created, which needs the service role (client-side code never
// has access to admin.auth.admin.*). Deleting a clinic is here too, for the
// same reason in reverse: cleanly removing its staff's auth accounts (not
// just their profile rows) needs the same service-role API.
//
// Deletion is two-stage: "trash" (disable the clinic, stamp deleted_at,
// fully recoverable) and "purge" (the actual irreversible cascade). A daily
// cron job calls `purge_expired`, authenticated with a dedicated
// CRON_PURGE_SECRET rather than the project's service-role key — the
// auto-injected SUPABASE_SERVICE_ROLE_KEY an edge function sees isn't
// guaranteed to string-match the "sb_secret_..." key shown in project
// settings/used elsewhere in this codebase (confirmed live: they don't), so
// comparing against it directly — the pattern notify-status-change uses —
// silently rejects a legitimate cron caller. A purpose-built secret sidesteps
// that entirely.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const admin = createClient(supabaseUrl, secretKey)
  const authHeader = req.headers.get('Authorization') ?? ''
  const isTrustedCaller = req.headers.get('x-cron-secret') === cronPurgeSecret

  let caller: { id: string } | null = null
  let callerProfile: { full_name: string } | null = null

  if (!isTrustedCaller) {
    const callerClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authHeader } } })
    const {
      data: { user },
    } = await callerClient.auth.getUser()
    if (!user) return new Response('unauthorized', { status: 401, headers: corsHeaders })
    caller = user

    const { data: profile } = await admin.from('profiles').select('role, disabled, full_name').eq('id', user.id).maybeSingle()
    if (!profile || profile.role !== 'admin' || profile.disabled) {
      return new Response('forbidden', { status: 403, headers: corsHeaders })
    }
    callerProfile = profile
  }

  const actorId = caller?.id ?? null
  const actorName = callerProfile?.full_name ?? 'System (scheduled purge)'

  function logAction(action: string, targetType: string, targetLabel: string, clinicId: string | null = null) {
    return admin
      .from('admin_audit_log')
      .insert({ actor_id: actorId, actor_name: actorName, action, target_type: targetType, target_label: targetLabel, clinic_id: clinicId })
  }

  function jsonError(message: string, status = 400) {
    return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  function jsonOk(body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // The actual cascading delete — every table that references the clinic,
  // then every staff auth account (which cascades to its profiles row via
  // the ON DELETE CASCADE FK), then the clinic row itself.
  // Files live under "<clinicId>/" in each bucket; deleting rows doesn't remove them (nightly S5).
  // Folders have no id in a listing: recurse into them, remove files a page at a time.
  // Returns how many list/remove calls failed, so the purge doesn't report "done" over leftover files (nightly S10).
  async function removeFolder(bucket: string, prefix: string): Promise<number> {
    let failures = 0
    for (;;) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
      if (error) return failures + 1
      if (!data?.length) return failures
      for (const folder of data.filter((item) => !item.id)) failures += await removeFolder(bucket, `${prefix}/${folder.name}`)
      const files = data.filter((item) => item.id).map((item) => `${prefix}/${item.name}`)
      if (files.length) {
        const { error: removeError } = await admin.storage.from(bucket).remove(files)
        if (removeError) return failures + 1
      }
      if (data.length < 1000) return failures
    }
  }

  async function purgeClinic(clinicId: string, clinicName: string) {
    const { data: pets } = await admin.from('pets').select('id').eq('clinic_id', clinicId)
    const petIds = (pets ?? []).map((p) => p.id)
    const { data: staffProfiles } = await admin.from('profiles').select('id').eq('clinic_id', clinicId)

    if (petIds.length > 0) {
      await admin.from('ownership_transfers').delete().in('pet_id', petIds)
      await admin.from('pet_trusted_contacts').delete().in('pet_id', petIds)
    }
    await admin.from('medical_records').delete().eq('clinic_id', clinicId)
    await admin.from('appointments').delete().eq('clinic_id', clinicId)
    await admin.from('payments').delete().eq('clinic_id', clinicId)
    // invoice_items cascade from invoices. Both must go before the profiles
    // are deleted (invoices.created_by/verified_by) and before the clinic row
    // (invoices.clinic_id and services.clinic_id have no ON DELETE CASCADE).
    await admin.from('invoices').delete().eq('clinic_id', clinicId)
    await admin.from('services').delete().eq('clinic_id', clinicId)
    await admin.from('pets').delete().eq('clinic_id', clinicId)

    for (const p of staffProfiles ?? []) {
      await admin.auth.admin.deleteUser(p.id)
    }

    const { error } = await admin.from('clinics').delete().eq('id', clinicId)
    if (error) return { error: error.message, storageFailures: 0 }

    // After the rows are gone, so a failed purge never leaves records pointing at missing files.
    let storageFailures = 0
    for (const bucket of ['pet-photos', 'clinic-logos', 'payment-documents']) storageFailures += await removeFolder(bucket, clinicId)

    const label = storageFailures ? `${clinicName} (files not fully removed: ${storageFailures} storage errors)` : clinicName
    await logAction('clinic_purged', 'clinic', label, clinicId)
    return { error: null, storageFailures }
  }

  const body = await req.json().catch(() => ({}))

  if (body.action === 'create') {
    if (isTrustedCaller) return jsonError('create is not available to the scheduled job', 403)

    const clinicName = String(body.clinicName ?? '').trim()
    const vetFullName = String(body.vetFullName ?? '').trim()
    // vetUsername may also be a real email.
    const login = parseStaffLogin(String(body.vetUsername ?? ''))
    const vetPassword = String(body.vetPassword ?? '')
    const vetPhone = body.vetPhone ? String(body.vetPhone).trim() : null

    if (!clinicName || !vetFullName || !login || vetPassword.length < MIN_PASSWORD_LENGTH) {
      return jsonError('Missing or invalid fields')
    }

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email: login.email,
      password: vetPassword,
      email_confirm: true,
    })
    if (userError || !userData.user) {
      const taken = /already|exists|registered/i.test(userError?.message ?? '')
      return jsonError(taken ? 'Username or email is taken' : (userError?.message ?? 'Could not create vet account'))
    }

    const { data: clinic, error: clinicError } = await admin.from('clinics').insert({ name: clinicName }).select('id, name').single()
    if (clinicError || !clinic) {
      await admin.auth.admin.deleteUser(userData.user.id)
      return jsonError(clinicError?.message ?? 'Could not create clinic')
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: userData.user.id,
      role: 'vet',
      clinic_role: 'manager',
      username: login.username,
      email: login.username ? null : login.email,
      full_name: vetFullName,
      phone: vetPhone,
      clinic_id: clinic.id,
    })
    if (profileError) {
      await admin.from('clinics').delete().eq('id', clinic.id)
      await admin.auth.admin.deleteUser(userData.user.id)
      return jsonError(profileError.message)
    }

    await logAction('clinic_created', 'clinic', `${clinic.name} (manager: ${vetFullName}, ${login.username ? '@' + login.username : login.email})`, clinic.id)
    return jsonOk({ clinicId: clinic.id, clinicName: clinic.name, vetId: userData.user.id })
  }

  if (body.action === 'reset_password') {
    if (isTrustedCaller) return jsonError('reset_password is not available to the scheduled job', 403)

    const userId = String(body.userId ?? '')
    const newPassword = String(body.newPassword ?? '')
    if (!userId || newPassword.length < 6) return jsonError('Missing or invalid fields')

    const { data: targetProfile } = await admin.from('profiles').select('full_name, clinic_id').eq('id', userId).maybeSingle()
    if (!targetProfile) return jsonError('User not found', 404)

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
    if (updateError) return jsonError(updateError.message)

    await logAction('password_reset', 'profile', targetProfile.full_name, targetProfile.clinic_id)
    return jsonOk({ ok: true })
  }

  if (body.action === 'trash') {
    if (isTrustedCaller) return jsonError('trash is not available to the scheduled job', 403)
    const clinicId = String(body.clinicId ?? '')
    if (!clinicId) return jsonError('Missing clinicId')

    const { data, error } = await admin
      .from('clinics')
      .update({ disabled: true, deleted_at: new Date().toISOString() })
      .eq('id', clinicId)
      .select('name')
      .single()
    if (error || !data) return jsonError(error?.message ?? 'Could not trash clinic')

    await logAction('clinic_trashed', 'clinic', data.name, clinicId)
    return jsonOk({ ok: true })
  }

  if (body.action === 'restore') {
    if (isTrustedCaller) return jsonError('restore is not available to the scheduled job', 403)
    const clinicId = String(body.clinicId ?? '')
    if (!clinicId) return jsonError('Missing clinicId')

    const { data, error } = await admin
      .from('clinics')
      .update({ disabled: false, deleted_at: null })
      .eq('id', clinicId)
      .select('name')
      .single()
    if (error || !data) return jsonError(error?.message ?? 'Could not restore clinic')

    await logAction('clinic_restored', 'clinic', data.name, clinicId)
    return jsonOk({ ok: true })
  }

  if (body.action === 'purge') {
    if (isTrustedCaller) return jsonError('purge is not available to the scheduled job', 403)
    const clinicId = String(body.clinicId ?? '')
    if (!clinicId) return jsonError('Missing clinicId')

    const { data: clinicRow } = await admin.from('clinics').select('name').eq('id', clinicId).maybeSingle()
    const { error, storageFailures } = await purgeClinic(clinicId, clinicRow?.name ?? clinicId)
    if (error) return jsonError(error)
    return jsonOk({ ok: true, storageFailures })
  }

  if (body.action === 'purge_expired') {
    if (!isTrustedCaller) return jsonError('purge_expired is only callable by the scheduled job', 403)

    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: expired } = await admin.from('clinics').select('id, name').not('deleted_at', 'is', null).lt('deleted_at', cutoff)

    // Trashed pets too (moved here from the 0047 SQL cron in 0077): SQL can't delete Storage files (nightly S9).
    // Paths are read before the delete; medical_records cascade from pets.
    const { data: expiredPets } = await admin.from('pets').select('id, photo_url').not('deleted_at', 'is', null).lt('deleted_at', cutoff)
    const petIds = (expiredPets ?? []).map((p) => p.id)
    let petStorageFailures = 0
    if (petIds.length) {
      const { data: records } = await admin.from('medical_records').select('photo_url').in('pet_id', petIds).not('photo_url', 'is', null)
      const paths = [...(expiredPets ?? []).map((p) => p.photo_url), ...(records ?? []).map((r) => r.photo_url)]
        .filter((path): path is string => !!path)
        .map((path) => path.split('?')[0])
      const { error: petError } = await admin.from('pets').delete().in('id', petIds)
      if (petError) return jsonError(petError.message, 500)
      if (paths.length) {
        const { error: removeError } = await admin.storage.from('pet-photos').remove(paths)
        if (removeError) petStorageFailures = 1
      }
    }

    const results = []
    for (const clinic of expired ?? []) {
      const { error, storageFailures } = await purgeClinic(clinic.id, clinic.name)
      results.push({ id: clinic.id, name: clinic.name, ok: !error && !storageFailures, error, storageFailures })
    }
    return jsonOk({ purged: results.length, results, petsPurged: petIds.length, petStorageFailures })
  }

  return jsonError('Unknown action')
})
