import webpush from 'npm:web-push@3.6.7'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

export type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string }
export type PushPayload = { title: string; body: string; url?: string; icon?: string }

// Throws with a `statusCode` on failure — 404/410 means the browser revoked
// the subscription and the caller should delete that row.
export async function sendWebPush(sub: PushSubscriptionRow, payload: PushPayload) {
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload),
  )
}

// pet-photos is private (0043): turn a stored photo_url (path, maybe ?t=) into
// a signed URL the notification can load. A day covers a delayed delivery.
export async function petPhotoIcon(admin: SupabaseClient, photoUrl: string | null | undefined) {
  if (!photoUrl) return undefined
  const { data } = await admin.storage.from('pet-photos').createSignedUrl(photoUrl.split('?')[0], 60 * 60 * 24)
  return data?.signedUrl
}

// Sends to every subscription and deletes the ones the browser has revoked.
export function sendToSubscriptions(admin: SupabaseClient, subs: PushSubscriptionRow[], payload: PushPayload) {
  return Promise.all(
    subs.map(async (sub) => {
      try {
        await sendWebPush(sub, payload)
        return { endpoint: sub.endpoint, ok: true }
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
        }
        return { endpoint: sub.endpoint, ok: false, statusCode, message: err instanceof Error ? err.message : String(err) }
      }
    }),
  )
}
