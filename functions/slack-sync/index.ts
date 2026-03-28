import { createAdminClient } from '../_shared/insforge-admin.ts';
import { fetchChannels, fetchHistory } from '../_shared/slack-api.ts';

Deno.serve(async (req: Request) => {
  try {
    const { workspace_id } = await req.json();
    const admin = createAdminClient();

    // Fetch workspace with bot token
    const { data: workspace, error: wsError } = await admin.database
      .from('workspaces')
      .select('*')
      .eq('id', workspace_id)
      .single();

    if (wsError || !workspace) {
      return new Response(JSON.stringify({ error: 'Workspace not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const botToken = workspace.bot_token;
    const lastSyncedAt = workspace.last_synced_at;

    // 1. Sync channels
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

    // 2. Fetch our stored channels to get their UUIDs
    const { data: dbChannels } = await admin.database
      .from('channels')
      .select('id, slack_channel_id')
      .eq('workspace_id', workspace.id);

    const channelMap = new Map(
      (dbChannels ?? []).map((c: any) => [c.slack_channel_id, c.id])
    );

    // 3. Sync messages for each channel (limit to 20 most recent)
    // Convert last_synced_at to Slack timestamp format
    const oldestTs = lastSyncedAt
      ? (new Date(lastSyncedAt).getTime() / 1000).toString()
      : undefined;

    let totalMessages = 0;
    const channelsToSync = slackChannels.slice(0, 20); // Cap at 20 channels per run

    for (const ch of channelsToSync) {
      const channelUuid = channelMap.get(ch.id);
      if (!channelUuid) continue;

      try {
        const messages = await fetchHistory(botToken, ch.id, oldestTs);

        for (const msg of messages) {
          // Skip bot messages, join/leave messages, etc.
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

        // Update channel's last_message_at
        if (messages.length > 0) {
          const latestTs = Math.max(...messages.map((m: any) => parseFloat(m.ts)));
          await admin.database
            .from('channels')
            .update({ last_message_at: new Date(latestTs * 1000).toISOString() })
            .eq('id', channelUuid);
        }
      } catch (err) {
        // Log but continue syncing other channels
        console.error(`Failed to sync channel ${ch.name}:`, err);
      }

      // Rate limiting: small delay between channels
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // 4. Update sync watermark
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
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Sync error:', err);
    return new Response(
      JSON.stringify({ error: 'Sync failed', details: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
