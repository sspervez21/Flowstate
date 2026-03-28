import { useInfiniteQuery } from '@tanstack/react-query';
import { insforge } from '../insforge';
import type { Message } from '../lib/types';

const PAGE_SIZE = 20;

interface UseFeedOptions {
  channelId?: string;
  userId?: string;
}

export function useFeed({ channelId, userId }: UseFeedOptions) {
  return useInfiniteQuery<Message[]>({
    queryKey: ['feed', channelId, userId],
    queryFn: async ({ pageParam = 0 }) => {
      // Phase 1: query messages directly, sorted by posted_at DESC
      // Phase 2 will switch to match_messages_for_user RPC
      let query = insforge.database
        .from('messages')
        .select('*, channels!inner(name)')
        .order('posted_at', { ascending: false })
        .range(pageParam as number, (pageParam as number) + PAGE_SIZE - 1);

      if (channelId) {
        query = query.eq('channel_id', channelId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Flatten the joined channel name
      return (data ?? []).map((msg: any) => ({
        ...msg,
        channel_name: msg.channels?.name,
        channels: undefined,
      }));
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.length * PAGE_SIZE;
    },
    enabled: !!userId,
  });
}
