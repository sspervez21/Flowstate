const SLACK_API_BASE = 'https://slack.com/api';

interface SlackResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function slackFetch(method: string, token: string, params?: Record<string, string>): Promise<SlackResponse> {
  const url = new URL(`${SLACK_API_BASE}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API ${method} failed: ${data.error}`);
  }
  return data;
}

export async function exchangeCode(code: string): Promise<{
  team: { id: string; name: string };
  authed_user: { id: string; access_token: string };
  access_token: string; // bot token
}> {
  const clientId = Deno.env.get('SLACK_CLIENT_ID')!;
  const clientSecret = Deno.env.get('SLACK_CLIENT_SECRET')!;

  const res = await fetch(`${SLACK_API_BASE}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`OAuth exchange failed: ${data.error}`);
  }
  return data;
}

export async function fetchUserInfo(token: string, userId: string) {
  const data = await slackFetch('users.info', token, { user: userId });
  const user = data.user as any;
  return {
    id: user.id as string,
    displayName: (user.profile?.display_name || user.real_name || user.name) as string,
    avatarUrl: (user.profile?.image_72 || '') as string,
  };
}

export async function fetchChannels(token: string) {
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

export async function fetchHistory(
  token: string,
  channelId: string,
  oldest?: string,
): Promise<any[]> {
  const params: Record<string, string> = {
    channel: channelId,
    limit: '100',
  };
  if (oldest) params.oldest = oldest;

  const data = await slackFetch('conversations.history', token, params);
  return (data.messages as any[]) ?? [];
}
