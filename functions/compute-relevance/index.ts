// Phase 2: Relevance scoring Edge Function
// This function embeds new messages and computes per-user relevance scores

import { createAdminClient } from '../_shared/insforge-admin.ts';
import { embedTexts } from '../_shared/embeddings.ts';

Deno.serve(async (req: Request) => {
  try {
    const { workspace_id } = await req.json();
    const admin = createAdminClient();

    // 1. Find messages without embeddings
    const { data: unembedded, error: fetchError } = await admin.database
      .from('messages')
      .select('id, content, channel_id, channels(name)')
      .eq('workspace_id', workspace_id)
      .is('embedding', null)
      .limit(100);

    if (fetchError) throw fetchError;
    if (!unembedded || unembedded.length === 0) {
      return new Response(JSON.stringify({ message: 'No new messages to embed' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Prepare texts for embedding
    const texts = unembedded.map((msg: any) => {
      const content = msg.content || '';
      const channelName = msg.channels?.name || '';
      // Prepend channel name for short messages to improve embedding quality
      if (content.split(/\s+/).length < 10 && channelName) {
        return `#${channelName}: ${content}`;
      }
      return content;
    });

    // 3. Batch embed
    const embeddings = await embedTexts(texts);

    // 4. Update messages with embeddings
    for (let i = 0; i < unembedded.length; i++) {
      await admin.database
        .from('messages')
        .update({ embedding: embeddings[i] })
        .eq('id', (unembedded[i] as any).id);
    }

    // 5. Compute relevance scores for each user in this workspace
    const { data: users } = await admin.database
      .from('users')
      .select('id')
      .eq('workspace_id', workspace_id);

    // TODO Phase 2: For each user, compute composite scores
    // using preference_embedding, recency, engagement, channel_boost

    return new Response(
      JSON.stringify({
        embedded: unembedded.length,
        users_scored: users?.length || 0,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Compute relevance error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed', details: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
