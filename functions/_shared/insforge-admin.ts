import { createClient } from '@insforge/sdk';

// Server-side InsForge client using service role key.
// This bypasses Row Level Security — use only in Edge Functions.
export function createAdminClient() {
  const url = Deno.env.get('INSFORGE_URL');
  const serviceRoleKey = Deno.env.get('INSFORGE_SERVICE_ROLE_KEY');

  if (!url || !serviceRoleKey) {
    throw new Error('Missing INSFORGE_URL or INSFORGE_SERVICE_ROLE_KEY');
  }

  return createClient({
    baseUrl: url,
    anonKey: serviceRoleKey, // service role key acts as the auth key with elevated privileges
  });
}
