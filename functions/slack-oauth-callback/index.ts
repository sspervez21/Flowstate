import { createAdminClient } from '../_shared/insforge-admin.ts';
import { exchangeCode, fetchUserInfo } from '../_shared/slack-api.ts';

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Frontend URL to redirect to after auth
  const frontendUrl = Deno.env.get('FRONTEND_URL') || 'http://localhost:5173';

  if (error) {
    return Response.redirect(`${frontendUrl}/login?error=${error}`, 302);
  }

  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  try {
    // 1. Exchange code for Slack tokens
    const oauthData = await exchangeCode(code);
    const { team, authed_user, access_token: botToken } = oauthData;

    // 2. Get user profile from Slack
    const userInfo = await fetchUserInfo(botToken, authed_user.id);

    // 3. Upsert workspace
    const admin = createAdminClient();

    const { data: workspace, error: wsError } = await admin.database
      .from('workspaces')
      .upsert(
        {
          slack_team_id: team.id,
          team_name: team.name,
          bot_token: botToken,
        },
        { onConflict: 'slack_team_id' }
      )
      .select('id')
      .single();

    if (wsError) throw wsError;

    // 4. Create or sign in InsForge auth user
    // Use Slack user ID as the email identifier
    const email = `${authed_user.id}@slack.local`;
    const password = `slack_${team.id}_${authed_user.id}`;

    let authUserId: string;
    let accessToken: string | null = null;

    // Try to sign in first
    const { data: signInData, error: signInError } = await admin.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // User doesn't exist, create them
      const { data: signUpData, error: signUpError } = await admin.auth.signUp({
        email,
        password,
      });
      if (signUpError) throw signUpError;
      authUserId = signUpData!.user!.id;
      accessToken = signUpData!.accessToken;
    } else {
      authUserId = signInData!.user.id;
      accessToken = signInData!.accessToken;
    }

    // 5. Upsert user profile in our users table
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

    if (userError) throw userError;

    // 6. Redirect to frontend with access token
    if (accessToken) {
      const redirectUrl = new URL(`${frontendUrl}/feed`);
      redirectUrl.hash = `access_token=${accessToken}`;
      return Response.redirect(redirectUrl.toString(), 302);
    }

    return Response.redirect(`${frontendUrl}/login?error=no_session`, 302);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return Response.redirect(
      `${frontendUrl}/login?error=auth_failed`,
      302
    );
  }
});
