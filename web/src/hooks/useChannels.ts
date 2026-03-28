import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Channel } from '../lib/types';

export function useChannels() {
  return useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => apiFetch<Channel[]>('get-channels'),
  });
}
