import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { sendWebPush } from '../_shared/push.ts'

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
  // clinic's appointment by guessing/observing an ID. A request carrying
  // the service-role key itself is trusted (used for debugging/ops).
  const authHeader = req.headers.get('Authorization') ?? ''
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
    } = await callerClient.auth.getUser()
    if (!user) return new Response('unauthorized', { status: 401, headers: corsHeaders })

    const { data: callerProfile } = await admin.from('profiles').select('clinic_id').eq('id', user.id).maybeSingle()
    if (!callerProfile || callerProfile.clinic_id !== appointment.clinic_id) {
      return new Response('forbidden', { status: 403, headers: corsHeaders })
    }
  }

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, push_notify_statuses')
    .eq('clinic_id', appointment.clinic_id)

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
    icon: pet?.photo_url ?? undefined,
  }

  const results = await Promise.all(
    (subscriptions ?? []).map(async (sub) => {
      try {
        await sendWebPush(sub, payload)
        return { endpoint: sub.endpoint, ok: true }
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
        }
        return {
          endpoint: sub.endpoint,
          ok: false,
          statusCode,
          message: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )

  return new Response(JSON.stringify({ recipientCount: recipientIds.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
