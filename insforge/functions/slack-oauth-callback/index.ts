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
  // Use ANON_KEY (JWT) for auth operations; API_KEY (ik_...) for database
  return createClient({
    baseUrl: Deno.env.get('INSFORGE_BASE_URL')!,
    anonKey: Deno.env.get('ANON_KEY')!,
  });
}

function createDbClient() {
  // Use API_KEY for database operations that need to bypass RLS
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

// Robust auth: try signIn, then signUp, then signIn again if "already exists"
async function getOrCreateAuthUser(
  authClient: ReturnType<typeof createClient>,
  email: string,
  password: string
): Promise<{ userId: string; accessToken: string }> {
  // Attempt 1: sign in
  console.log('Attempting signIn for:', email);
  const { data: signInData, error: signInError } =
    await authClient.auth.signInWithPassword({ email, password });

  if (!signInError && signInData?.accessToken) {
    console.log('SignIn success');
    return { userId: signInData.user.id, accessToken: signInData.accessToken };
  }
  console.log('SignIn failed:', signInError);

  // Attempt 2: sign up
  console.log('Attempting signUp for:', email);
  const { data: signUpData, error: signUpError } =
    await authClient.auth.signUp({ email, password });

  if (!signUpError && signUpData?.accessToken) {
    console.log('SignUp success');
    return { userId: signUpData.user!.id, accessToken: signUpData.accessToken };
  }
  console.log('SignUp failed:', signUpError);

  // Attempt 3: if "already exists", retry signIn
  const errMsg = signUpError?.message || String(signUpError);
  if (errMsg.toLowerCase().includes('already exists') || errMsg.toLowerCase().includes('duplicate')) {
    console.log('User exists, retrying signIn...');
    const { data: retryData, error: retryError } =
      await authClient.auth.signInWithPassword({ email, password });

    if (!retryError && retryData?.accessToken) {
      console.log('Retry signIn success');
      return { userId: retryData.user.id, accessToken: retryData.accessToken };
    }
    console.error('Retry signIn also failed:', retryError);
    throw new Error(`Auth failed after retry: ${retryError?.message || 'unknown'}`);
  }

  throw signUpError || new Error('Auth failed');
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

    // Step 3: Upsert workspace (using API_KEY client for DB access)
    const db = createDbClient();
    const { data: workspace, error: wsError } = await db.database
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

    // Step 4: Create or sign in InsForge auth user (using ANON_KEY client for auth)
    const authClient = createAdminClient();
    const email = `${authed_user.id}@slack.local`;
    const password = `slack_${team.id}_${authed_user.id}`;

    const { userId: authUserId, accessToken } =
      await getOrCreateAuthUser(authClient, email, password);

    // Step 5: Upsert user profile (using API_KEY client for DB access)
    const { error: userError } = await db.database
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

    const dest = `${frontendUrl}/feed#access_token=${accessToken}`;
    console.log('Redirecting to frontend with token');
    return htmlRedirect(dest);
  } catch (err) {
    console.error('OAuth callback error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return htmlRedirect(`${frontendUrl}/login?error=auth_failed&detail=${encodeURIComponent(msg)}`);
  }
}
