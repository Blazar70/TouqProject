// Crash reports must not carry owner phones (sentry.ts); own file so its test needs no Supabase client.
export const scrubPhones = (text: string) => text.replace(/\+?\d{9,}/g, '[phone]')
