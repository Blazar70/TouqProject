import { createClient } from 'npm:@supabase/supabase-js@2'
import { petPhotoIcon, sendToSubscriptions } from '../_shared/push.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Cron-scheduled (every 15 minutes). For each enabled staff member with a
// reminder lead time set, finds their clinic's upcoming appointments that are
// due within that lead time (plus one tick), and sends a push if one hasn't
// already gone out for that appointment+profile pair. Starting the window at
// "now" (not at now + lead) also covers appointments booked inside the lead
// time and ticks that ran late or were skipped.
Deno.serve(async (req) => {
  // Only the cron job (which sends the service-role key) may run this.
  if (req.headers.get('Authorization') !== `Bearer ${serviceRoleKey}`) {
    return new Response('unauthorized', { status: 401 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const now = Date.now()

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, clinic_id, push_reminder_lead_minutes, clinics!inner(disabled)')
    .not('push_reminder_lead_minutes', 'is', null)
    .not('clinic_id', 'is', null)
    .eq('disabled', false)
    .eq('clinics.disabled', false)

  for (const profile of profiles ?? []) {
    const leadMinutes = profile.push_reminder_lead_minutes!
    const windowEnd = new Date(now + (leadMinutes + 15) * 60_000)

    const { data: appointments } = await admin
      .from('appointments')
      .select('id, pets(name, photo_url)')
      .eq('clinic_id', profile.clinic_id!)
      .in('status', ['requested', 'confirmed'])
      .gte('scheduled_at', new Date(now).toISOString())
      .lt('scheduled_at', windowEnd.toISOString())

    for (const appointment of appointments ?? []) {
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

  return new Response('ok')
})
