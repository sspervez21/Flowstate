// Phase 2: Embeddings helper using InsForge SDK's built-in AI module

import { createAdminClient } from './insforge-admin.ts';

const MODEL = 'openai/text-embedding-3-small';

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const admin = createAdminClient();

  const response = await admin.ai.embeddings.create({
    model: MODEL,
    input: texts,
  });

  return response.data.map((item: any) => item.embedding);
}
