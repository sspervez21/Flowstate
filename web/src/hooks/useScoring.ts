import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

export function useScoreMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ scored: number; total: number }>('score-messages'),
    onSuccess: (data) => {
      console.log('[scoring] Success:', data);
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: (err) => {
      console.error('[scoring] Failed:', err);
    },
  });
}
