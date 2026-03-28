import { createClient } from 'https://esm.sh/@insforge/sdk';

// Use HTML redirect since the Edge Function runtime follows 302 headers internally
function htmlRedirect(url: string): Response {
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${url}"><script>window.location.href="${url}";</script></head><body>Redirecting...</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function createAdminClient() {
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

export default async function(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const frontendUrl = Deno.env.get('FRONTEND_URL') || 'http://localhost:5173';

  // Build the redirect_uri that matches what the frontend sent to Slack
  const insforgeUrl = Deno.env.get('INSFORGE_BASE_URL')!;
  const redirectUri = `${insforgeUrl}/functions/slack-oauth-callback`;

  if (error) {
    return htmlRedirect(`${frontendUrl}/login?error=${error}`);
  }
  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  try {
    // Step 1: Exchange code for Slack tokens
    console.log('Exchanging OAuth code with redirect_uri:', redirectUri);
    const oauthData = await exchangeCode(code, redirectUri);
    const { team, authed_user, access_token: botToken } = oauthData;
    console.log('OAuth exchange success, team:', team.id, 'user:', authed_user.id);

    // Step 2: Fetch Slack user info
    const userInfo = await fetchUserInfo(botToken, authed_user.id);
    console.log('Fetched user info:', userInfo.displayName);

    // Step 3: Create admin client and upsert workspace
    const admin = createAdminClient();

    const { data: workspace, error: wsError } = await admin.database
      .from('workspaces')
      .upsert(
        { slack_team_id: team.id, team_name: team.name, bot_token: botToken },
        { onConflict: 'slack_team_id' }
      )
      .select('id')
      .single();
    if (wsError) {
      console.error('Workspace upsert error:', JSON.stringify(wsError));
      throw wsError;
    }
    console.log('Workspace upserted:', workspace!.id);

    // Step 4: Create or sign in InsForge auth user
    const email = `${authed_user.id}@slack.local`;
    const password = `slack_${team.id}_${authed_user.id}`;
    let authUserId: string;
    let accessToken: string | null = null;

    const { data: signInData, error: signInError } =
      await admin.auth.signInWithPassword({ email, password });

    if (signInError) {
      console.log('Sign in failed (new user), signing up...');
      const { data: signUpData, error: signUpError } =
        await admin.auth.signUp({ email, password });
      if (signUpError) {
        console.error('Sign up error:', JSON.stringify(signUpError));
        throw signUpError;
      }
      authUserId = signUpData!.user!.id;
      accessToken = signUpData!.accessToken;
      console.log('Sign up success, user:', authUserId);
    } else {
      authUserId = signInData!.user.id;
      accessToken = signInData!.accessToken;
      console.log('Sign in success, user:', authUserId);
    }

    // Step 5: Upsert user profile
    const { error: userError } = await admin.database
      .from('users')
      .upsert(
        {
          id: authUserId,
          workspace_id: workspace!.id,
          slack_user_id: authed_user.id,
          display_name: userInfo.displayName,
          avatar_url: userInfo.avatarUrl,
          slack_token: authed_user.access_token,
        },
        { onConflict: 'workspace_id,slack_user_id' }
      );
    if (userError) {
      console.error('User upsert error:', JSON.stringify(userError));
      throw userError;
    }
    console.log('User profile upserted');

    if (accessToken) {
      const dest = `${frontendUrl}/feed#access_token=${accessToken}`;
      console.log('Redirecting to frontend with token');
      return htmlRedirect(dest);
    }
    return htmlRedirect(`${frontendUrl}/login?error=no_session`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return htmlRedirect(`${frontendUrl}/login?error=auth_failed&detail=${encodeURIComponent(msg)}`);
  }
}
