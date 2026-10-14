import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendToSubscriptions } from '../_shared/push.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Cron-scheduled (every 15 minutes). For each profile with a reminder lead
// time set, finds their clinic's upcoming appointments that fall due within
// the next tick, and sends a push if one hasn't already gone out for that
// appointment+profile pair.
Deno.serve(async () => {
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const now = Date.now()

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, clinic_id, push_reminder_lead_minutes')
    .not('push_reminder_lead_minutes', 'is', null)
    .not('clinic_id', 'is', null)

  for (const profile of profiles ?? []) {
    const leadMinutes = profile.push_reminder_lead_minutes!
    const windowStart = new Date(now + leadMinutes * 60_000)
    const windowEnd = new Date(windowStart.getTime() + 15 * 60_000)

    const { data: appointments } = await admin
      .from('appointments')
      .select('id, pets(name, photo_url)')
      .eq('clinic_id', profile.clinic_id!)
      .in('status', ['requested', 'confirmed'])
      .gte('scheduled_at', windowStart.toISOString())
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
        body: `Reminder: ${pet?.name ?? 'A pet'}'s appointment is coming up.`,
        url: '/appointments',
        icon: pet?.photo_url ?? undefined,
      }

      await sendToSubscriptions(admin, subscriptions ?? [], payload)

      await admin.from('appointment_reminders_sent').insert({ appointment_id: appointment.id, profile_id: profile.id })
    }
  }

  return new Response('ok')
})
