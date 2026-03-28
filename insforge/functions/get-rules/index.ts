import { createClient } from 'https://esm.sh/@insforge/sdk';

// ─── Inline JWT: verifyJWT ──────────────────────────────────────────────────────

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binStr = atob(padded);
  return Uint8Array.from(binStr, (c) => c.charCodeAt(0));
}

function textEncode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

async function verifyJWT(token: string, secret: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const [header, body, sig] = parts;
  const key = await crypto.subtle.importKey(
    'raw', textEncode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const valid = await crypto.subtle.verify(
    'HMAC', key, base64urlDecode(sig), textEncode(`${header}.${body}`),
  );
  if (!valid) throw new Error('Invalid JWT signature');
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('JWT expired');
  return payload as { sub: string; workspace_id: string; slack_user_id: string };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function createDbClient() {
  return createClient({
    baseUrl: Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('API_KEY')!,
  });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Missing Authorization header');
  return verifyJWT(authHeader.slice(7), Deno.env.get('JWT_SECRET')!);
}

// ─── Handler ────────────────────────────────────────────────────────────────────

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const claims = await authenticate(req);
    const db = createDbClient();

    const { data, error } = await db.database
      .from('user_rules')
      .select('*')
      .eq('user_id', claims.sub)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return json(data ?? []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid') || msg.includes('expired') || msg.includes('Missing')) {
      return json({ error: msg }, 401);
    }
    console.error('get-rules error:', err);
    return json({ error: msg }, 500);
  }
}
