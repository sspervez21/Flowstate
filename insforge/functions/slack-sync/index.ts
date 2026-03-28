import { createClient } from 'https://esm.sh/@insforge/sdk';

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
    const { workspace_id } = await req.json();
    const admin = createAdminClient();

    const { data: workspace, error: wsError } = await admin.database
      .from('workspaces')
      .select('*')
      .eq('id', workspace_id)
      .single();

    if (wsError || !workspace) {
      return new Response(
        JSON.stringify({ error: 'Workspace not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        { onConflict: 'workspace_id,slack_channel_id' }
      );
    }

    // Get channel UUID map
    const { data: dbChannels } = await admin.database
      .from('channels')
      .select('id, slack_channel_id')
      .eq('workspace_id', workspace.id);
    const channelMap = new Map(
      (dbChannels ?? []).map((c: any) => [c.slack_channel_id, c.id])
    );

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
              author_name: msg.user || 'Unknown',
              content: msg.text,
              thread_ts: msg.thread_ts !== msg.ts ? msg.thread_ts : null,
              reply_count: msg.reply_count || 0,
              reaction_count: msg.reactions
                ? msg.reactions.reduce((sum: number, r: any) => sum + (r.count || 0), 0)
                : 0,
              posted_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
            },
            { onConflict: 'workspace_id,channel_id,slack_ts' }
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
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Sync error:', err);
    return new Response(
      JSON.stringify({ error: 'Sync failed', details: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
