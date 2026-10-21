import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { petPhotoIcon, sendToSubscriptions } from '../_shared/push.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const { appointmentId } = await req.json()
  if (!appointmentId) return new Response('missing appointmentId', { status: 400, headers: corsHeaders })

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: appointment } = await admin
    .from('appointments')
    .select('id, clinic_id, status, pets(name, photo_url)')
    .eq('id', appointmentId)
    .maybeSingle()
  if (!appointment) return new Response('not found', { status: 404, headers: corsHeaders })

  // Confirm the caller belongs to the same clinic as the appointment —
  // otherwise anyone with a valid login could trigger a push for another
  // clinic's appointment by guessing/observing an ID.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await callerClient.auth.getUser()
  if (!user) return new Response('unauthorized', { status: 401, headers: corsHeaders })

  // A removed (disabled) member's access token stays valid until it expires.
  const { data: callerProfile } = await admin.from('profiles').select('clinic_id, disabled').eq('id', user.id).maybeSingle()
  if (!callerProfile || callerProfile.disabled || callerProfile.clinic_id !== appointment.clinic_id) {
    return new Response('forbidden', { status: 403, headers: corsHeaders })
  }

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, push_notify_statuses')
    .eq('clinic_id', appointment.clinic_id)
    .eq('disabled', false)

  const recipientIds = (profiles ?? [])
    .filter((p) => (p.push_notify_statuses as string[] | null)?.includes(appointment.status))
    .map((p) => p.id)
  if (recipientIds.length === 0) return new Response('ok', { headers: corsHeaders })

  const { data: subscriptions } = await admin.from('push_subscriptions').select('*').in('profile_id', recipientIds)

  const pet = appointment.pets as { name: string; photo_url: string | null } | null
  const payload = {
    title: 'Touq',
    body: `${pet?.name ?? 'A pet'}'s appointment is now ${appointment.status}.`,
    url: '/appointments',
    icon: await petPhotoIcon(admin, pet?.photo_url),
  }

  const results = await sendToSubscriptions(admin, subscriptions ?? [], payload)

  return new Response(JSON.stringify({ recipientCount: recipientIds.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
