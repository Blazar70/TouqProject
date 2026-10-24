// New-style API keys. Supabase retires the legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY by
// end of 2026; the new ones are injected as JSON like {"default": "sb_secret_..."}.
function injectedKey(name: string): string {
  const keys = JSON.parse(Deno.env.get(name) ?? '{}')
  return keys.default ?? Object.values(keys)[0]
}

export const publishableKey = injectedKey('SUPABASE_PUBLISHABLE_KEYS')
export const secretKey = injectedKey('SUPABASE_SECRET_KEYS')
