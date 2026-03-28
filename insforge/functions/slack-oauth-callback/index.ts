import { createClient } from 'https://esm.sh/@insforge/sdk';

// ─── Inline JWT: createJWT ─────────────────────────────────────────────────────

function base64urlEncode(data: Uint8Array): string {
  const binStr = Array.from(data, (b) => String.fromCharCode(b)).join('');
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function textEncode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function createJWT(
  payload: { sub: string; workspace_id: string; slack_user_id: string },
  secret: string,
  expiresInSeconds = 7 * 24 * 60 * 60,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const header = base64urlEncode(textEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64urlEncode(textEncode(JSON.stringify(fullPayload)));
  const signingInput = `${header}.${body}`;
  const key = await getKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncode(signingInput)));
  return `${signingInput}.${base64urlEncode(sig)}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function htmlRedirect(url: string): Response {
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${url}"><script>window.location.href="${url}";</script></head><body>Redirecting...</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function createDbClient() {
  return createClient({
    baseUrl: Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('API_KEY')!,
  });
}

async function exchangeCode(code: string, redirectUri: string): Promise<any> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('SLACK_CLIENT_ID')!,
      client_secret: Deno.env.get('SLACK_CLIENT_SECRET')!,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`OAuth exchange failed: ${data.error}`);
  return data;
}

async function fetchUserInfo(token: string, userId: string) {
  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`users.info failed: ${data.error}`);
  const u = data.user;
  return {
    id: u.id,
    displayName: u.profile?.display_name || u.real_name || u.name || '',
    avatarUrl: u.profile?.image_72 || '',
  };
}

// ─── Handler ────────────────────────────────────────────────────────────────────

export default async function(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const frontendUrl = Deno.env.get('FRONTEND_URL') || 'http://localhost:5173';
  const insforgeUrl = Deno.env.get('INSFORGE_BASE_URL')!;
  const redirectUri = `${insforgeUrl}/functions/slack-oauth-callback`;
  const jwtSecret = Deno.env.get('JWT_SECRET')!;

  if (error) {
    return htmlRedirect(`${frontendUrl}/login?error=${error}`);
  }
  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  try {
    // 1. Exchange code for Slack tokens
    console.log('Exchanging OAuth code with redirect_uri:', redirectUri);
    const oauthData = await exchangeCode(code, redirectUri);
    const { team, authed_user, access_token: botToken } = oauthData;
    console.log('OAuth success, team:', team.id, 'user:', authed_user.id);

    // 2. Fetch Slack user profile
    const userInfo = await fetchUserInfo(botToken, authed_user.id);
    console.log('Fetched user info:', userInfo.displayName);

    // 3. Upsert workspace
    const db = createDbClient();
    const { data: workspace, error: wsError } = await db.database
      .from('workspaces')
      .upsert(
        { slack_team_id: team.id, team_name: team.name, bot_token: botToken },
        { onConflict: 'slack_team_id' },
      )
      .select('id')
      .single();
    if (wsError) {
      console.error('Workspace upsert error:', JSON.stringify(wsError));
      throw wsError;
    }
    console.log('Workspace upserted:', workspace!.id);

    // 4. Upsert user (Postgres generates UUID via DEFAULT gen_random_uuid())
    const { data: user, error: userError } = await db.database
      .from('users')
      .upsert(
        {
          workspace_id: workspace!.id,
          slack_user_id: authed_user.id,
          display_name: userInfo.displayName,
          avatar_url: userInfo.avatarUrl,
          slack_token: authed_user.access_token || '',
        },
        { onConflict: 'workspace_id,slack_user_id' },
      )
      .select('id')
      .single();
    if (userError) {
      console.error('User upsert error:', JSON.stringify(userError));
      throw userError;
    }
    console.log('User upserted:', user!.id);

    // 5. Sign JWT
    const jwt = await createJWT(
      {
        sub: user!.id,
        workspace_id: workspace!.id,
        slack_user_id: authed_user.id,
      },
      jwtSecret,
    );

    // 6. Redirect to frontend with JWT in URL hash
    const dest = `${frontendUrl}/feed#access_token=${jwt}`;
    console.log('Redirecting to frontend with JWT');
    return htmlRedirect(dest);
  } catch (err) {
    console.error('OAuth callback error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return htmlRedirect(
      `${frontendUrl}/login?error=auth_failed&detail=${encodeURIComponent(msg)}`,
    );
  }
}
