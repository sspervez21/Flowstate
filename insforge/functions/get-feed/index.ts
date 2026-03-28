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

const PAGE_SIZE = 20;

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

    let channelId: string | undefined;
    let offset = 0;
    let limit = PAGE_SIZE;
    let threshold = 0; // 0 = show everything, 0.95 = only top 5%

    try {
      const body = await req.json();
      channelId = body.channel_id;
      if (typeof body.offset === 'number') offset = body.offset;
      if (typeof body.limit === 'number') limit = Math.min(body.limit, 100);
      if (typeof body.threshold === 'number') threshold = body.threshold;
    } catch {
      // No body or invalid JSON — use defaults
    }

    const db = createDbClient();

    // Fetch more messages than needed since we'll filter by threshold
    const fetchLimit = threshold > 0 ? limit * 5 : limit;

    let query = db.database
      .from('messages')
      .select('*, channels!inner(name)')
      .eq('workspace_id', claims.workspace_id)
      .order('posted_at', { ascending: false })
      .range(offset, offset + fetchLimit - 1);

    if (channelId) {
      query = query.eq('channel_id', channelId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const messageIds = (data ?? []).map((m: any) => m.id);

    // Fetch relevance scores for these messages
    let scoreMap = new Map<string, { score: number; signals: Record<string, number>; scored_at: string }>();
    if (messageIds.length > 0) {
      const { data: scores } = await db.database
        .from('relevance_scores')
        .select('message_id, score, signals, scored_at')
        .eq('user_id', claims.sub)
        .in('message_id', messageIds);

      for (const s of (scores ?? []) as any[]) {
        scoreMap.set(s.message_id, { score: s.score, signals: s.signals, scored_at: s.scored_at });
      }
    }

    // Build messages with scores, filter by threshold
    const messages = (data ?? [])
      .map((msg: any) => {
        const scoreData = scoreMap.get(msg.id);
        return {
          ...msg,
          channel_name: msg.channels?.name,
          channels: undefined,
          relevance_score: scoreData?.score ?? null,
          relevance_signals: scoreData?.signals ?? null,
          relevance_scored_at: scoreData?.scored_at ?? null,
        };
      })
      .filter((msg: any) => {
        if (threshold <= 0) return true; // no filtering
        if (msg.relevance_score === null) return true; // unscored messages always shown
        return msg.relevance_score >= threshold;
      })
      .slice(0, limit);

    return json(messages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid') || msg.includes('expired') || msg.includes('Missing')) {
      return json({ error: msg }, 401);
    }
    console.error('get-feed error:', err);
    return json({ error: msg }, 500);
  }
}
