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

// ─── AI Scoring ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 20;

interface MessageToScore {
  id: string;
  content: string;
  author_name: string;
  author_slack_id: string;
  channel_name: string;
  channel_id: string;
  reply_count: number;
  reaction_count: number;
  posted_at: string;
}

function buildSystemPrompt(
  userName: string,
  slackUserId: string,
  channelStats: Array<{ channel_name: string; messages_sent: number; mentions_received: number }>,
  userRules: Array<{ rule_type: string; config: any }>,
): string {
  const channelContext = channelStats.length > 0
    ? `\nChannels the user is most active in (by messages sent):\n${channelStats.map(c => `- #${c.channel_name}: ${c.messages_sent} messages sent, ${c.mentions_received} mentions received`).join('\n')}`
    : '';

  const rulesContext = userRules.length > 0
    ? `\nUser-defined rules:\n${userRules.map(r => {
        if (r.rule_type === 'keyword') return `- BOOST messages containing: "${r.config.keyword}" (weight: ${r.config.weight || 'high'})`;
        if (r.rule_type === 'channel_boost') return `- BOOST channel #${r.config.channel_name} (weight: ${r.config.weight || 'high'})`;
        if (r.rule_type === 'person_boost') return `- BOOST messages from: ${r.config.person_name} (weight: ${r.config.weight || 'high'})`;
        if (r.rule_type === 'topic') return `- User is interested in topic: "${r.config.topic}"`;
        return `- ${r.rule_type}: ${JSON.stringify(r.config)}`;
      }).join('\n')}`
    : '';

  return `You are a relevance scoring engine for Slack messages. You score how relevant each message is to a specific user.

The user is "${userName}" (Slack ID: <@${slackUserId}>).
${channelContext}
${rulesContext}

Score each message from 0.0 (completely irrelevant) to 1.0 (must-see).

Scoring criteria (in order of importance):
1. DIRECT MENTION: Message contains <@${slackUserId}> or mentions "${userName}" → score 0.9-1.0
2. ACTION ITEMS: Questions or tasks directed at someone, especially the user → score 0.7-0.9
3. CHANNEL ACTIVITY: Messages in channels the user is most active in → boost by 0.1-0.2
4. HIGH ENGAGEMENT: Messages with many reactions/replies → boost by 0.05-0.15
5. CONTENT RELEVANCE: Messages about topics similar to what the user discusses → boost by 0.1-0.2
6. GENERAL CHATTER: Casual messages, greetings, off-topic → score 0.1-0.3

For each message, return a JSON object with:
- "id": the message ID (pass through exactly)
- "score": float 0.0-1.0
- "signals": object with signal names and their contribution (must sum roughly to the score)
  Signal names: "mention", "action_item", "channel_affinity", "engagement", "content_relevance", "user_rule"

Return ONLY a JSON array. No markdown, no explanation.`;
}

function buildUserPrompt(messages: MessageToScore[]): string {
  return `Score these ${messages.length} messages:\n\n${messages.map((m, i) => `[${i + 1}] ID: ${m.id}
Channel: #${m.channel_name}
Author: ${m.author_name} (${m.author_slack_id})
Reactions: ${m.reaction_count} | Replies: ${m.reply_count}
Time: ${m.posted_at}
Content: ${m.content.slice(0, 500)}
---`).join('\n')}`;
}

async function callAI(
  systemPrompt: string,
  userPrompt: string,
  baseUrl: string,
  apiKey: string,
): Promise<Array<{ id: string; score: number; signals: Record<string, number> }>> {
  const res = await fetch(`${baseUrl}/api/ai/chat/completion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      maxTokens: 4000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Parse JSON from response (handle markdown code blocks)
  const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  return JSON.parse(jsonStr);
}

// ─── Handler ────────────────────────────────────────────────────────────────────

export default async function(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const claims = await authenticate(req);
    const db = createDbClient();
    const baseUrl = Deno.env.get('INSFORGE_BASE_URL')!;
    const apiKey = Deno.env.get('API_KEY')!;

    // 1. Get user info
    const { data: user } = await db.database
      .from('users')
      .select('*')
      .eq('id', claims.sub)
      .single();
    if (!user) return json({ error: 'User not found' }, 404);

    // 2. Get unscored messages for this user
    const { data: unscoredMessages, error: msgError } = await db.database
      .from('messages')
      .select('id, content, author_name, author_slack_id, channel_id, reply_count, reaction_count, posted_at, channels!inner(name)')
      .eq('workspace_id', claims.workspace_id)
      .not('id', 'in', `(SELECT message_id FROM relevance_scores WHERE user_id = '${claims.sub}')`)
      .order('posted_at', { ascending: false })
      .limit(BATCH_SIZE);

    // Fallback: if the subquery filter doesn't work, fetch and filter manually
    let messagesToScore: MessageToScore[];
    if (msgError || !unscoredMessages) {
      console.log('Subquery filter failed, using manual approach:', msgError);
      // Get all recent messages
      const { data: allMsgs } = await db.database
        .from('messages')
        .select('id, content, author_name, author_slack_id, channel_id, reply_count, reaction_count, posted_at, channels!inner(name)')
        .eq('workspace_id', claims.workspace_id)
        .order('posted_at', { ascending: false })
        .limit(100);

      // Get already-scored message IDs
      const { data: scored } = await db.database
        .from('relevance_scores')
        .select('message_id')
        .eq('user_id', claims.sub);
      const scoredIds = new Set((scored ?? []).map((s: any) => s.message_id));

      messagesToScore = ((allMsgs ?? []) as any[])
        .filter((m: any) => !scoredIds.has(m.id))
        .slice(0, BATCH_SIZE)
        .map((m: any) => ({
          id: m.id,
          content: m.content,
          author_name: m.author_name,
          author_slack_id: m.author_slack_id,
          channel_name: m.channels?.name || 'unknown',
          channel_id: m.channel_id,
          reply_count: m.reply_count,
          reaction_count: m.reaction_count,
          posted_at: m.posted_at,
        }));
    } else {
      messagesToScore = (unscoredMessages as any[]).map((m: any) => ({
        id: m.id,
        content: m.content,
        author_name: m.author_name,
        author_slack_id: m.author_slack_id,
        channel_name: m.channels?.name || 'unknown',
        channel_id: m.channel_id,
        reply_count: m.reply_count,
        reaction_count: m.reaction_count,
        posted_at: m.posted_at,
      }));
    }

    if (messagesToScore.length === 0) {
      return json({ scored: 0, message: 'No unscored messages' });
    }

    // 3. Get user channel stats
    const { data: channelStats } = await db.database
      .from('user_channel_stats')
      .select('channel_id, messages_sent, mentions_received')
      .eq('user_id', claims.sub)
      .order('messages_sent', { ascending: false })
      .limit(10);

    // Map channel IDs to names
    const channelIds = (channelStats ?? []).map((s: any) => s.channel_id);
    let statsWithNames: Array<{ channel_name: string; messages_sent: number; mentions_received: number }> = [];
    if (channelIds.length > 0) {
      const { data: chNames } = await db.database
        .from('channels')
        .select('id, name')
        .in('id', channelIds);
      const nameMap = new Map((chNames ?? []).map((c: any) => [c.id, c.name]));
      statsWithNames = (channelStats ?? []).map((s: any) => ({
        channel_name: nameMap.get(s.channel_id) || 'unknown',
        messages_sent: s.messages_sent,
        mentions_received: s.mentions_received,
      }));
    }

    // 4. Get user rules
    const { data: rules } = await db.database
      .from('user_rules')
      .select('rule_type, config')
      .eq('user_id', claims.sub)
      .eq('enabled', true);

    // 5. Call AI to score
    const systemPrompt = buildSystemPrompt(
      user.display_name,
      user.slack_user_id,
      statsWithNames,
      (rules ?? []) as any[],
    );
    const userPrompt = buildUserPrompt(messagesToScore);

    console.log(`Scoring ${messagesToScore.length} messages for user ${user.display_name}`);
    const scores = await callAI(systemPrompt, userPrompt, baseUrl, apiKey);

    // 6. Write scores to DB
    let written = 0;
    for (const s of scores) {
      const { error: insertErr } = await db.database
        .from('relevance_scores')
        .upsert(
          {
            message_id: s.id,
            user_id: claims.sub,
            score: Math.max(0, Math.min(1, s.score)),
            signals: s.signals || {},
          },
          { onConflict: 'message_id,user_id' },
        );
      if (insertErr) {
        console.error(`Failed to write score for ${s.id}:`, insertErr);
      } else {
        written++;
      }
    }

    console.log(`Scored ${written}/${messagesToScore.length} messages`);
    return json({ scored: written, total: messagesToScore.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid') || msg.includes('expired') || msg.includes('Missing')) {
      return json({ error: msg }, 401);
    }
    console.error('score-messages error:', err);
    return json({ error: msg }, 500);
  }
}
