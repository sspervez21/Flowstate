import { createClient } from 'https://esm.sh/@insforge/sdk';

// --- Inline helpers (no local imports) ---

function createAdminClient() {
  const url = Deno.env.get('INSFORGE_URL');
  const serviceRoleKey = Deno.env.get('INSFORGE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('Missing INSFORGE_URL or INSFORGE_SERVICE_ROLE_KEY');
  return createClient({ baseUrl: url, anonKey: serviceRoleKey });
}

async function exchangeCode(code: string) {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('SLACK_CLIENT_ID')!,
      client_secret: Deno.env.get('SLACK_CLIENT_SECRET')!,
      code,
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

// --- Main handler ---

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const frontendUrl = Deno.env.get('FRONTEND_URL') || 'http://localhost:5173';

  if (error) return Response.redirect(`${frontendUrl}/login?error=${error}`, 302);
  if (!code) return new Response('Missing code parameter', { status: 400 });

  try {
    const oauthData = await exchangeCode(code);
    const { team, authed_user, access_token: botToken } = oauthData;
    const userInfo = await fetchUserInfo(botToken, authed_user.id);

    const admin = createAdminClient();

    // Upsert workspace
    const { data: workspace, error: wsError } = await admin.database
      .from('workspaces')
      .upsert({ slack_team_id: team.id, team_name: team.name, bot_token: botToken }, { onConflict: 'slack_team_id' })
      .select('id')
      .single();
    if (wsError) throw wsError;

    // Create or sign in auth user
    const email = `${authed_user.id}@slack.local`;
    const password = `slack_${team.id}_${authed_user.id}`;
    let authUserId: string;
    let accessToken: string | null = null;

    const { data: signInData, error: signInError } = await admin.auth.signInWithPassword({ email, password });
    if (signInError) {
      const { data: signUpData, error: signUpError } = await admin.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
      authUserId = signUpData!.user!.id;
      accessToken = signUpData!.accessToken;
    } else {
      authUserId = signInData!.user.id;
      accessToken = signInData!.accessToken;
    }

    // Upsert user profile
    const { error: userError } = await admin.database
      .from('users')
      .upsert({
        id: authUserId,
        workspace_id: workspace!.id,
        slack_user_id: authed_user.id,
        display_name: userInfo.displayName,
        avatar_url: userInfo.avatarUrl,
        slack_token: authed_user.access_token,
      }, { onConflict: 'workspace_id,slack_user_id' });
    if (userError) throw userError;

    if (accessToken) {
      const redirectUrl = new URL(`${frontendUrl}/feed`);
      redirectUrl.hash = `access_token=${accessToken}`;
      return Response.redirect(redirectUrl.toString(), 302);
    }
    return Response.redirect(`${frontendUrl}/login?error=no_session`, 302);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return Response.redirect(`${frontendUrl}/login?error=auth_failed`, 302);
  }
});
