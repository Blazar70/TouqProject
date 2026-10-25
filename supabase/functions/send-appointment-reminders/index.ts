import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { petPhotoIcon, sendToSubscriptions } from '../_shared/push.ts'
import { getsAlert, getsInpatientAlert } from '../_shared/alertRecipients.ts'
import { secretKey } from '../_shared/keys.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const cronSecret = Deno.env.get('CRON_PURGE_SECRET')

// Cron-scheduled (every 15 minutes). For each enabled staff member with a
// reminder lead time set, finds their clinic's upcoming appointments that are
// due within that lead time (plus one tick), and sends a push if one hasn't
// already gone out for that appointment+profile pair. Starting the window at
// "now" (not at now + lead) also covers appointments booked inside the lead
// time and ticks that ran late or were skipped.
Deno.serve(async (req) => {
  // Only the cron job (0079, x-cron-secret from Vault) may run this. Not the secret key as a Bearer
  // token: the new sb_secret_ keys are rejected there. The secret is shared with the purge job.
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  const admin = createClient(supabaseUrl, secretKey)
  const now = Date.now()

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, clinic_id, clinic_role, push_reminder_lead_minutes, clinics!inner(disabled), staff_branches(branch_id)')
    .not('push_reminder_lead_minutes', 'is', null)
    .not('clinic_id', 'is', null)
    .eq('disabled', false)
    .eq('clinics.disabled', false)

  for (const profile of profiles ?? []) {
    const leadMinutes = profile.push_reminder_lead_minutes!
    const windowEnd = new Date(now + (leadMinutes + 15) * 60_000)

    const { data: appointments } = await admin
      .from('appointments')
      .select('id, doctor_id, branch_id, pets(name, photo_url)')
      .eq('clinic_id', profile.clinic_id!)
      .in('status', ['requested', 'confirmed'])
      .gte('scheduled_at', new Date(now).toISOString())
      .lt('scheduled_at', windowEnd.toISOString())

    const me = {
      id: profile.id,
      clinic_role: profile.clinic_role,
      branchIds: (profile.staff_branches as { branch_id: string }[]).map((b) => b.branch_id),
    }
    // Same rule as status alerts: the doctor's own appointments, or the branches they work at.
    for (const appointment of (appointments ?? []).filter((a) => getsAlert(me, a))) {
      const { data: alreadySent } = await admin
        .from('appointment_reminders_sent')
        .select('appointment_id')
        .eq('appointment_id', appointment.id)
        .eq('profile_id', profile.id)
        .maybeSingle()
      if (alreadySent) continue

      const { data: subscriptions } = await admin.from('push_subscriptions').select('*').eq('profile_id', profile.id)

      const pet = appointment.pets as { name: string; photo_url: string | null } | null
      const payload = {
        title: 'Touq',
        // Both languages: staff language lives on the device, not the account (user, 2026-10-23).
        body: `Reminder: ${pet?.name ?? 'A pet'}'s appointment is coming up.\nتذكير: موعد ${pet?.name ?? 'الحيوان'} قريب.`,
        url: '/appointments',
        icon: await petPhotoIcon(admin, pet?.photo_url),
      }

      await sendToSubscriptions(admin, subscriptions ?? [], payload)

      await admin.from('appointment_reminders_sent').insert({ appointment_id: appointment.id, profile_id: profile.id })
    }
  }

  await sendInpatientDoseReminders(admin, now)

  return new Response('ok')
})

// Inpatient medication/check reminders (0082): one push per due time that nobody has marked done,
// to the doctors and nurses at the pet's branch. The last hour is looked at so a late or skipped
// tick still sends; older misses only show as overdue in the app.
async function sendInpatientDoseReminders(admin: SupabaseClient, now: number) {
  const { data: slots, error } = await admin.rpc('inpatient_task_slots', {
    p_from: new Date(now - 60 * 60_000).toISOString(),
    p_to: new Date(now).toISOString(),
  })
  if (error) {
    console.error('inpatient_task_slots', error.message)
    return
  }
  for (const slot of (slots ?? []).filter((s: { done_at: string | null }) => !s.done_at)) {
    // Claim the due time first, so two overlapping runs can't both send it.
    const { data: claimed } = await admin
      .from('inpatient_task_alerts_sent')
      .upsert({ task_id: slot.task_id, due_at: slot.due_at }, { onConflict: 'task_id,due_at', ignoreDuplicates: true })
      .select('task_id')
    if (!claimed?.length) continue

    const { data: task } = await admin
      .from('inpatient_tasks')
      .select('label, clinic_id, stay:inpatient_stays!inner(branch_id, pet:pets(id, name, photo_url))')
      .eq('id', slot.task_id)
      .single()
    if (!task) continue
    const stay = task.stay as unknown as { branch_id: string; pet: { id: string; name: string; photo_url: string | null } | null }

    const { data: staff } = await admin
      .from('profiles')
      .select('id, clinic_role, staff_branches(branch_id), clinics!inner(disabled)')
      .eq('clinic_id', task.clinic_id)
      .eq('disabled', false)
      .eq('clinics.disabled', false)
      .in('clinic_role', ['doctor', 'nurse'])
      // 0086: each person can switch dose pushes off in Settings.
      .eq('inpatient_dose_push', true)
    const recipients = (staff ?? []).filter((p) =>
      getsInpatientAlert({ id: p.id, clinic_role: p.clinic_role, branchIds: (p.staff_branches as { branch_id: string }[]).map((b) => b.branch_id) }, stay.branch_id),
    )
    if (!recipients.length) continue

    const { data: subscriptions } = await admin.from('push_subscriptions').select('*').in('profile_id', recipients.map((p) => p.id))
    const petName = stay.pet?.name ?? ''
    await sendToSubscriptions(admin, subscriptions ?? [], {
      title: 'Touq',
      // Both languages, like the appointment reminders.
      body: `Due now: ${task.label} for ${petName}.\nحان الآن: ${task.label} لـ ${petName}.`,
      url: stay.pet ? `/pets/${stay.pet.id}` : '/inpatients',
      icon: await petPhotoIcon(admin, stay.pet?.photo_url),
    })
  }
}
