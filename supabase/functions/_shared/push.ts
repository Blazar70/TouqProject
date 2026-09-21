import webpush from 'npm:web-push@3.6.7'

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
