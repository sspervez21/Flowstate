import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

export function useSyncStatus() {
  return useQuery<{ lastSyncedAt: string | null }>({
    queryKey: ['sync-status'],
    queryFn: () => apiFetch<{ lastSyncedAt: string | null }>('get-sync-status'),
    refetchInterval: 30_000,
  });
}
