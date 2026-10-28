import { supabase } from './supabase'
import type { TranslationKey } from './i18n/translations'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export const REMINDER_LEAD_OPTIONS: { labelKey: TranslationKey; minutes: number }[] = [
  { labelKey: 'settings.reminder30min', minutes: 30 },
  { labelKey: 'settings.reminder1hour', minutes: 60 },
  { labelKey: 'settings.reminder2hours', minutes: 120 },
  { labelKey: 'settings.reminder1day', minutes: 1440 },
  { labelKey: 'settings.reminder2days', minutes: 2880 },
]

// Best-effort — a failed push notification shouldn't surface as an error
// to the person who just successfully updated the appointment.
export function notifyStatusChange(appointmentId: string) {
  supabase.functions.invoke('notify-status-change', { body: { appointmentId } }).catch(() => {})
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

// iPhone/iPad get web push only in the Home Screen app (iOS 16.4+), never in a browser tab (nightly H32).
// iPadOS reports itself as a Mac, so a touch Mac counts as an iPad.
export function needsHomeScreenInstall() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios && !window.matchMedia('(display-mode: standalone)').matches
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64Safe)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

export async function subscribeToPush(profileId: string) {
  if (!VAPID_PUBLIC_KEY) throw new Error('Missing VITE_VAPID_PUBLIC_KEY in .env')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission denied')

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  const json = subscription.toJSON()

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      profile_id: profileId,
      endpoint: json.endpoint!,
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
}

export async function unsubscribeFromPush(profileId: string) {
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) await subscription.unsubscribe()

  const { error } = await supabase.from('push_subscriptions').delete().eq('profile_id', profileId)
  if (error) throw error
}

// Logging out of a shared device must stop alerts for the person leaving.
// Best effort: a push failure never blocks the logout itself.
export async function signOutThisDevice() {
  try {
    const registration = isPushSupported() ? await navigator.serviceWorker.getRegistration() : undefined
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
      await subscription.unsubscribe()
    }
  } catch {
    // ignore, see above
  }
  await supabase.auth.signOut({ scope: 'local' })
}

export async function hasActivePushSubscription() {
  if (!isPushSupported()) return false
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return subscription !== null
}
