import { createClient } from 'npm:@supabase/supabase-js@2.110.3'
import { corsHeaders } from '../_shared/cors.ts'
import { MIN_PASSWORD_LENGTH, parseStaffLogin } from '../_shared/staffRules.ts'
import { publishableKey, secretKey } from '../_shared/keys.ts'
import { MFA_ENFORCED, jwtAal } from '../_shared/aal.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const cronPurgeSecret = Deno.env.get('CRON_PURGE_SECRET')!

const TRASH_RETENTION_DAYS = 7
// Trashed pets purged per request batch: 100 uuids keep the `in.(...)` URL well under the gateway limit.
const PET_BATCH = 100

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
    if (MFA_ENFORCED && jwtAal(authHeader) !== 'aal2') return new Response('mfa_required', { status: 403, headers: corsHeaders })
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

  // Every row of a query, a page at a time: PostgREST returns at most 1,000 per request (nightly B34).
  async function readAll<T>(
    page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ): Promise<{ rows: T[]; error: string | null }> {
    const rows: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await page(from, from + 999)
      if (error) return { rows, error: error.message }
      rows.push(...(data ?? []))
      if ((data?.length ?? 0) < 1000) return { rows, error: null }
    }
  }

  async function purgeClinic(clinicId: string, clinicName: string) {
    const { data: staffProfiles } = await admin.from('profiles').select('id').eq('clinic_id', clinicId)

    // ownership_transfers, pet_trusted_contacts and every other pet child cascade from pets (checked 11-01).
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
    for (const bucket of ['pet-photos', 'clinic-logos', 'payment-documents', 'inpatient-media']) storageFailures += await removeFolder(bucket, clinicId)

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

  // Lost phone: remove the user's two-step factors; they set up a new one at their next sign-in.
  if (body.action === 'reset_mfa') {
    if (isTrustedCaller) return jsonError('reset_mfa is not available to the scheduled job', 403)

    const userId = String(body.userId ?? '')
    const { data: targetProfile } = await admin.from('profiles').select('full_name, clinic_id').eq('id', userId).maybeSingle()
    if (!targetProfile) return jsonError('User not found', 404)

    const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({ userId })
    if (listError) return jsonError(listError.message)
    for (const factor of factors.factors) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id })
      if (error) return jsonError(error.message)
    }

    await logAction('mfa_reset', 'profile', targetProfile.full_name, targetProfile.clinic_id)
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

    // Two steps on purpose: trash (undoable for 7 days) first, then purge (nightly B33).
    const { data: clinicRow } = await admin.from('clinics').select('name, deleted_at').eq('id', clinicId).maybeSingle()
    if (!clinicRow) return jsonError('Clinic not found', 404)
    if (!clinicRow.deleted_at) return jsonError('Move the clinic to the trash first', 409)
    const { error, storageFailures } = await purgeClinic(clinicId, clinicRow.name)
    if (error) return jsonError(error)
    return jsonOk({ ok: true, storageFailures })
  }

  if (body.action === 'purge_expired') {
    if (!isTrustedCaller) return jsonError('purge_expired is only callable by the scheduled job', 403)

    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: expired } = await admin.from('clinics').select('id, name').not('deleted_at', 'is', null).lt('deleted_at', cutoff)

    // Trashed pets too (moved here from the 0047 SQL cron in 0077): SQL can't delete Storage files (nightly S9).
    // In batches (a long id list doesn't fit in a URL), every read paged past the 1,000-row cap, and a failing
    // batch is reported without stopping the rest or the clinics below (nightly B34). Paths are read before the
    // delete; medical_records and inpatient stays cascade from pets.
    const expiredPetIds = await readAll<{ id: string }>((from, to) =>
      admin.from('pets').select('id').not('deleted_at', 'is', null).lt('deleted_at', cutoff).order('id').range(from, to),
    )
    let petsPurged = 0
    let petStorageFailures = 0
    const petErrors: string[] = []
    if (expiredPetIds.error) petErrors.push(expiredPetIds.error)
    for (let i = 0; i < expiredPetIds.rows.length; i += PET_BATCH) {
      const ids = expiredPetIds.rows.slice(i, i + PET_BATCH).map((p) => p.id)
      const [pets, records, updates] = await Promise.all([
        readAll<{ photo_url: string | null }>((from, to) => admin.from('pets').select('photo_url').in('id', ids).order('id').range(from, to)),
        readAll<{ photo_url: string | null }>((from, to) =>
          admin.from('medical_records').select('photo_url').in('pet_id', ids).not('photo_url', 'is', null).order('id').range(from, to),
        ),
        // Inpatient photos/videos (0081) live in their own bucket.
        readAll<{ media: string[] }>((from, to) =>
          admin.from('inpatient_updates').select('media, stay:inpatient_stays!inner(pet_id)').in('stay.pet_id', ids).order('id').range(from, to),
        ),
      ])
      const readError = pets.error ?? records.error ?? updates.error
      if (readError) {
        petErrors.push(readError) // keep the rows: deleting now would orphan files we couldn't list
        continue
      }
      const { error: petError } = await admin.from('pets').delete().in('id', ids)
      if (petError) {
        petErrors.push(petError.message)
        continue
      }
      petsPurged += ids.length
      const paths = [...pets.rows, ...records.rows]
        .map((row) => row.photo_url)
        .filter((path): path is string => !!path)
        .map((path) => path.split('?')[0])
      const stayMedia = updates.rows.flatMap((u) => u.media)
      for (const [bucket, files] of [['pet-photos', paths], ['inpatient-media', stayMedia]] as const) {
        for (let j = 0; j < files.length; j += 1000) {
          const { error: removeError } = await admin.storage.from(bucket).remove(files.slice(j, j + 1000))
          if (removeError) petStorageFailures += 1
        }
      }
    }

    const results = []
    for (const clinic of expired ?? []) {
      const { error, storageFailures } = await purgeClinic(clinic.id, clinic.name)
      results.push({ id: clinic.id, name: clinic.name, ok: !error && !storageFailures, error, storageFailures })
    }
    return jsonOk({ purged: results.length, results, petsPurged, petStorageFailures, petErrors })
  }

  return jsonError('Unknown action')
})
