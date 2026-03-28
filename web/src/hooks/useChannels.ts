import { useQuery } from '@tanstack/react-query';
import { insforge } from '../insforge';
import type { Channel } from '../lib/types';

export function useChannels(workspaceId?: string) {
  return useQuery<Channel[]>({
    queryKey: ['channels', workspaceId],
    queryFn: async () => {
      const { data, error } = await insforge.database
        .from('channels')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!workspaceId,
  });
}
