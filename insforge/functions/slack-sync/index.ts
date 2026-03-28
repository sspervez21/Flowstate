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

function createAdminClient() {
  return createClient({
    baseUrl: Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('API_KEY')!,
  });
}

async function slackFetch(method: string, token: string, params?: Record<string, string>) {
  const url = new URL(`https://slack.com/api/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API ${method} failed: ${data.error}`);
  return data;
}

async function slackPost(method: string, token: string, body: Record<string, string>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API ${method} failed: ${data.error}`);
  return data;
}

async function fetchUsers(token: string): Promise<Map<string, string>> {
  const userMap = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { limit: '200' };
    if (cursor) params.cursor = cursor;
    const data = await slackFetch('users.list', token, params);
    for (const u of (data.members as any[]) ?? []) {
      const name = u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id;
      userMap.set(u.id, name);
    }
    cursor = (data.response_metadata as any)?.next_cursor;
  } while (cursor);
  return userMap;
}

async function fetchChannels(token: string) {
  const channels: any[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = {
      types: 'public_channel',
      limit: '200',
      exclude_archived: 'true',
    };
    if (cursor) params.cursor = cursor;
    const data = await slackFetch('conversations.list', token, params);
    channels.push(...(data.channels as any[]));
    cursor = (data.response_metadata as any)?.next_cursor;
  } while (cursor);
  return channels;
}

async function fetchHistory(token: string, channelId: string, oldest?: string) {
  const params: Record<string, string> = { channel: channelId, limit: '100' };
  if (oldest) params.oldest = oldest;
  const data = await slackFetch('conversations.history', token, params);
  return (data.messages as any[]) ?? [];
}

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verify JWT and extract workspace_id from claims
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const token = authHeader.slice(7);
    const jwtSecret = Deno.env.get('JWT_SECRET')!;
    const claims = await verifyJWT(token, jwtSecret);
    const workspaceId = claims.workspace_id;

    const admin = createAdminClient();

    const { data: workspace, error: wsError } = await admin.database
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single();

    if (wsError || !workspace) {
      return new Response(
        JSON.stringify({ error: 'Workspace not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const botToken = workspace.bot_token;
    const lastSyncedAt = workspace.last_synced_at;

    // Sync channels
    const slackChannels = await fetchChannels(botToken);
    for (const ch of slackChannels) {
      await admin.database.from('channels').upsert(
        {
          workspace_id: workspace.id,
          slack_channel_id: ch.id,
          name: ch.name,
          topic: ch.topic?.value || null,
          member_count: ch.num_members || 0,
        },
        { onConflict: 'workspace_id,slack_channel_id' },
      );
    }

    // Get channel UUID map
    const { data: dbChannels } = await admin.database
      .from('channels')
      .select('id, slack_channel_id')
      .eq('workspace_id', workspace.id);
    const channelMap = new Map(
      (dbChannels ?? []).map((c: any) => [c.slack_channel_id, c.id]),
    );

    // Fetch workspace users for name resolution
    const userNameMap = await fetchUsers(botToken);

    // Sync messages (incremental using last_synced_at watermark)
    const oldestTs = lastSyncedAt
      ? (new Date(lastSyncedAt).getTime() / 1000).toString()
      : undefined;
    let totalMessages = 0;
    const channelsToSync = slackChannels.slice(0, 20); // cap at 20 channels

    for (const ch of channelsToSync) {
      const channelUuid = channelMap.get(ch.id);
      if (!channelUuid) continue;
      try {
        // Bot must join the channel before it can read history (requires POST)
        try {
          await slackPost('conversations.join', botToken, { channel: ch.id });
        } catch {
          // Already a member or can't join — continue anyway
        }
        const messages = await fetchHistory(botToken, ch.id, oldestTs);
        for (const msg of messages) {
          if (msg.subtype && msg.subtype !== 'thread_broadcast') continue;
          if (!msg.text) continue;
          await admin.database.from('messages').upsert(
            {
              workspace_id: workspace.id,
              channel_id: channelUuid,
              slack_ts: msg.ts,
              author_slack_id: msg.user || 'unknown',
              author_name: userNameMap.get(msg.user) || msg.user || 'Unknown',
              content: msg.text,
              thread_ts: msg.thread_ts !== msg.ts ? msg.thread_ts : null,
              reply_count: msg.reply_count || 0,
              reaction_count: msg.reactions
                ? msg.reactions.reduce((sum: number, r: any) => sum + (r.count || 0), 0)
                : 0,
              posted_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
            },
            { onConflict: 'workspace_id,channel_id,slack_ts' },
          );
          totalMessages++;
        }
        if (messages.length > 0) {
          const latestTs = Math.max(...messages.map((m: any) => parseFloat(m.ts)));
          await admin.database
            .from('channels')
            .update({ last_message_at: new Date(latestTs * 1000).toISOString() })
            .eq('id', channelUuid);
        }
      } catch (err) {
        console.error(`Failed to sync channel ${ch.name}:`, err);
      }
      // Rate limiting: 200ms delay between channels
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Update watermark
    await admin.database
      .from('workspaces')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', workspace.id);

    return new Response(
      JSON.stringify({
        success: true,
        channels_synced: channelsToSync.length,
        messages_synced: totalMessages,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Sync error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid') || msg.includes('expired') || msg.includes('Missing')) {
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ error: 'Sync failed', details: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
}
