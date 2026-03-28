import { useQuery } from '@tanstack/react-query';
import { insforge } from '../insforge';

export function useSyncStatus(workspaceId?: string) {
  return useQuery<{ lastSyncedAt: string | null }>({
    queryKey: ['sync-status', workspaceId],
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('workspaces')
        .select('last_synced_at')
        .eq('id', workspaceId!)
        .single();

      if (error) throw error;
      return { lastSyncedAt: data?.last_synced_at ?? null };
    },
    enabled: !!workspaceId,
    refetchInterval: 30_000, // Poll every 30 seconds
  });
}
