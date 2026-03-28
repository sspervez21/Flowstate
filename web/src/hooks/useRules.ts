import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { UserRule } from '../lib/types';

export function useRules() {
  return useQuery<UserRule[]>({
    queryKey: ['rules'],
    queryFn: () => apiFetch<UserRule[]>('get-rules'),
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rule_type: string; config: Record<string, unknown> }) =>
      apiFetch<UserRule>('update-rules', { action: 'create', ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });
}

export function useToggleRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rule_id: string; enabled: boolean }) =>
      apiFetch<UserRule>('update-rules', { action: 'toggle', ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule_id: string) =>
      apiFetch('update-rules', { action: 'delete', rule_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });
}
