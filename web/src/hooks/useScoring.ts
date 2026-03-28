import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

export function useScoreMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ scored: number; total: number }>('score-messages'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}
