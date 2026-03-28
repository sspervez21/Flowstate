import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { UserRule } from '../lib/types';

export function useRules() {
  return useQuery<UserRule[]>({
    queryKey: ['rules'],
    queryFn: () => apiFetch<UserRule[]>('get-rules'),
  });
}

function useRuleMutation<T>(
  mutationFn: (vars: T) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rules'] });
      // Auto-rescore: clear old scores and re-score with updated rules
      try {
        await apiFetch('score-messages', { force: true });
        qc.invalidateQueries({ queryKey: ['feed'] });
      } catch (err) {
        console.error('Auto-rescore failed:', err);
      }
    },
  });
}

export function useCreateRule() {
  return useRuleMutation((vars: { rule_type: string; config: Record<string, unknown> }) =>
    apiFetch<UserRule>('update-rules', { action: 'create', ...vars }),
  );
}

export function useUpdateRule() {
  return useRuleMutation((vars: { rule_id: string; config: Record<string, unknown> }) =>
    apiFetch<UserRule>('update-rules', { action: 'update', ...vars }),
  );
}

export function useToggleRule() {
  return useRuleMutation((vars: { rule_id: string; enabled: boolean }) =>
    apiFetch<UserRule>('update-rules', { action: 'toggle', ...vars }),
  );
}

export function useDeleteRule() {
  return useRuleMutation((rule_id: string) =>
    apiFetch('update-rules', { action: 'delete', rule_id }),
  );
}
