import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Message } from '../lib/types';

const PAGE_SIZE = 20;

interface UseFeedOptions {
  channelId?: string;
}

export function useFeed({ channelId }: UseFeedOptions = {}) {
  return useInfiniteQuery<Message[]>({
    queryKey: ['feed', channelId],
    queryFn: async ({ pageParam = 0 }) => {
      return apiFetch<Message[]>('get-feed', {
        channel_id: channelId,
        offset: pageParam as number,
        limit: PAGE_SIZE,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.length * PAGE_SIZE;
    },
  });
}
