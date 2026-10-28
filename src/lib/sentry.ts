import * as Sentry from '@sentry/react'
import { supabase } from './supabase'

// Crash reports (user 10-28): only the error, page, browser and the user's + clinic's IDs. No session replay,
// no names. Loaded from main.tsx only when VITE_SENTRY_DSN is set (the staging site's build variable).
export function startSentry(dsn: string) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // v11 collects bodies, headers, cookies and query params by default; Supabase bodies hold owner names.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    // Search filters travel in Supabase URLs (owner names, phones): keep only the path.
    beforeBreadcrumb(crumb) {
      if (crumb.data?.url) crumb.data.url = String(crumb.data.url).split('?')[0]
      return crumb
    },
    beforeSend(event) {
      if (event.request?.url) event.request.url = event.request.url.split('?')[0]
      return event
    },
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    const id = session?.user.id
    Sentry.setUser(id ? { id } : null)
    if (!id) return Sentry.setTag('clinic', null)
    supabase
      .from('profiles')
      .select('clinic_id')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => Sentry.setTag('clinic', data?.clinic_id ?? 'admin'))
  })
}
